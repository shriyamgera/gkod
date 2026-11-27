"""The HTTP side: /health, /run (Server-Sent Events) and /stop, for the GKod site only, on this Mac only."""

import base64
import binascii
import json
import re
from contextlib import asynccontextmanager
from typing import Any, Literal

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from . import __version__, pairing
from .claude import MODEL, ClaudeInfo
from .config import MAX_BODY_BYTES, MAX_IMAGE_BYTES, PAIRING_HEADER, Settings
from .jobs import Busy, JobRequest, Runner

OPEN_PATHS = {"/health"}
SESSION_ID = r"^[0-9a-fA-F-]{36}$"

ALLOW_HEADERS = "content-type, x-gkod-pairing"
ALLOW_METHODS = "GET, POST, OPTIONS"


def _plain(status: int, error: str, message: str, headers: dict[str, str] | None = None) -> JSONResponse:
    return JSONResponse({"error": error, "message": message}, status_code=status, headers=headers)


class Guard:
    """Every request: the Host must be this Mac's address (no DNS rebinding), an Origin must be on the allow-list,
    preflights are answered (with Chrome's Private Network Access header), and every path but /health needs the
    pairing code."""

    def __init__(self, app: ASGIApp, settings: Settings) -> None:
        self.app = app
        self.settings = settings
        self.hosts = {f"127.0.0.1:{settings.port}", f"localhost:{settings.port}"}

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope["headers"]}
        origin = headers.get("origin")
        if headers.get("host", "").lower() not in self.hosts:
            await _plain(403, "host", "The bridge only answers on 127.0.0.1.")(scope, receive, send)
            return
        if origin is not None and origin not in self.settings.origins:
            await _plain(403, "origin", "This page may not use the bridge.")(scope, receive, send)
            return
        cors = {"Access-Control-Allow-Origin": origin, "Vary": "Origin"} if origin else {}

        if scope["method"] == "OPTIONS":
            preflight = {
                **cors,
                "Access-Control-Allow-Methods": ALLOW_METHODS,
                "Access-Control-Allow-Headers": ALLOW_HEADERS,
                "Access-Control-Max-Age": "600",
            }
            if headers.get("access-control-request-private-network") == "true":
                preflight["Access-Control-Allow-Private-Network"] = "true"
            await Response(status_code=204, headers=preflight)(scope, receive, send)
            return

        if scope["path"] not in OPEN_PATHS and not pairing.matches(headers.get(PAIRING_HEADER), self.settings.pairing_code):
            await _plain(401, "pairing", "The pairing code is missing or wrong.", cors)(scope, receive, send)
            return

        # the connection is closed after a 413, so the rest of a big body is not even taken in
        too_big = _plain(413, "too-big", "The request is too big.", {**cors, "Connection": "close"})
        length = headers.get("content-length")
        if length and (not length.isdigit() or int(length) > MAX_BODY_BYTES):
            await too_big(scope, receive, send)
            return
        # The body is read here, counting bytes, so the cap also holds for a chunked body with no Content-Length.
        body = await _read_body(receive, MAX_BODY_BYTES)
        if body is None:
            await too_big(scope, receive, send)
            return
        if body is _GONE:
            return

        async def send_with_cors(message: Message) -> None:
            if message["type"] == "http.response.start" and cors:
                raw = list(message.get("headers", []))
                raw += [(k.lower().encode(), v.encode()) for k, v in cors.items()]
                message = {**message, "headers": raw}
            await send(message)

        await self.app(scope, _replay(body, receive), send_with_cors)


_GONE = b"\0gone"


async def _read_body(receive: Receive, limit: int) -> bytes | None:
    """The whole request body, None once it passes limit, or _GONE when the page went away while sending."""
    chunks: list[bytes] = []
    size = 0
    while True:
        message = await receive()
        if message["type"] == "http.disconnect":
            return _GONE
        chunk = message.get("body", b"")
        size += len(chunk)
        if size > limit:
            return None
        chunks.append(chunk)
        if not message.get("more_body", False):
            return b"".join(chunks)


def _replay(body: bytes, receive: Receive) -> Receive:
    """Gives the app the body already read, then the real messages (so a closed page is still noticed)."""
    given = False

    async def replay() -> Message:
        nonlocal given
        if not given:
            given = True
            return {"type": "http.request", "body": body, "more_body": False}
        return await receive()

    return replay


class RunBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["create", "edit", "repair"]
    prompt: str | None = Field(None, max_length=4000)
    instruction: str | None = Field(None, max_length=4000)
    code: str | None = Field(None, max_length=60_000)
    error: str | None = Field(None, max_length=8000)
    # repair: what the code was written for
    request: str | None = Field(None, max_length=4000)
    # base64 JPEG or PNG, or a data: URL of one
    image: str | None = Field(None, max_length=MAX_BODY_BYTES)
    session_id: str | None = Field(None, pattern=SESSION_ID)
    model: str | None = Field(None, max_length=80)


def decode_image(value: str) -> tuple[bytes, str]:
    """The picture's bytes and type. Raises ValueError with a plain message."""
    data = re.sub(r"^data:image/[a-z+]+;base64,", "", value.strip())
    try:
        raw = base64.b64decode(data, validate=True)
    except (binascii.Error, ValueError):
        raise ValueError("The picture is not valid base64.") from None
    if len(raw) > MAX_IMAGE_BYTES:
        raise ValueError("The picture is over 4 MB.")
    if raw.startswith(b"\xff\xd8\xff"):
        return raw, "image/jpeg"
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        return raw, "image/png"
    raise ValueError("The picture must be a JPEG or PNG.")


def to_job(body: RunBody) -> JobRequest:
    """Checks that each kind has what it needs. Raises ValueError with a plain message."""
    image = decode_image(body.image) if body.image else None
    if body.model and not MODEL.match(body.model):
        raise ValueError("Unknown model.")
    if body.kind == "create" and not (body.prompt or "").strip() and not image:
        raise ValueError("A new part needs words or a picture.")
    if body.kind == "edit" and not ((body.instruction or "").strip() and (body.code or "").strip()):
        raise ValueError("A change needs the instruction and the current code.")
    if body.kind == "repair" and not ((body.code or "").strip() and (body.error or "").strip()):
        raise ValueError("A repair needs the code and the error.")
    if image and body.kind != "create":
        raise ValueError("Only a new part can have a picture.")
    return JobRequest(
        kind=body.kind,
        prompt=body.prompt or "",
        instruction=body.instruction or "",
        code=body.code or "",
        error=body.error or "",
        request=body.request or "",
        image=image,
        session_id=body.session_id,
        model=body.model,
    )


def sse(item: dict[str, Any] | None) -> bytes:
    if item is None:
        return b": still working\n\n"
    return f"event: {item['event']}\ndata: {json.dumps(item['data'])}\n\n".encode()


def create_app(settings: Settings) -> FastAPI:
    runner = Runner(settings)
    info = ClaudeInfo(settings.claude_path)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        settings.work_root.mkdir(parents=True, exist_ok=True, mode=0o700)
        runner.sessions.clean()
        yield
        await runner.shutdown()

    app = FastAPI(title="GKod bridge", version=__version__, lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.runner = runner

    @app.exception_handler(RequestValidationError)
    async def invalid(_: Request, exc: RequestValidationError) -> JSONResponse:
        first = exc.errors()[0] if exc.errors() else {}
        where = ".".join(str(part) for part in first.get("loc", []) if part != "body")
        return _plain(400, "bad-request", f"The request is not right{f' ({where})' if where else ''}.")

    @app.get("/health")
    async def health() -> dict[str, Any]:
        return {"ok": True, "bridge": __version__, **(await info.get()), "busy": runner.busy}

    @app.post("/run", response_model=None)
    async def run(body: RunBody) -> StreamingResponse | JSONResponse:
        try:
            req = to_job(body)
        except ValueError as problem:
            status = 413 if "over 4 MB" in str(problem) else 400
            return _plain(status, "bad-request", str(problem))
        try:
            job = runner.start(req)
        except Busy:
            return _plain(409, "busy", "Claude Code is already working on another part. Wait for it, or stop it.")

        async def stream():
            async for item in job.events():
                yield sse(item)

        return StreamingResponse(
            stream(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    @app.post("/stop")
    async def stop() -> dict[str, bool]:
        return {"stopped": runner.stop()}

    app.add_middleware(Guard, settings=settings)
    return app
