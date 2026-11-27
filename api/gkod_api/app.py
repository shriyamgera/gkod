"""The HTTP API in front of the parts library.

    uvicorn gkod_api.app:app --host 127.0.0.1 --port 8000

Read-only for now: health, the parts with filters, one part, and counts. Every answer is JSON, and every
error is {"error": "<plain words>"}.
"""

import logging
from contextlib import asynccontextmanager
from typing import Annotated, Any, Literal

import psycopg
from fastapi import FastAPI, Path, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from psycopg_pool import PoolTimeout
from starlette.exceptions import HTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from . import __version__
from .db import make_pool
from .migrate import latest_version
from .models import Generator, Health, LabelCounts, Part, PartList, PartSummary, Problem, RunStats, Stats
from .settings import Settings, get_settings

log = logging.getLogger("uvicorn.error")

MAX_BODY_BYTES = 64 * 1024
MAX_QUERY_BYTES = 2048
MAX_LIMIT = 200
# /health answers within this many seconds even when the database is down, so healthchecks do not time out.
HEALTH_TIMEOUT_S = 2.0

SUMMARY_COLUMNS = (
    "id, run_id, part_index, family, title, request, compile_ok, checks_ok, split,"
    " generator_name, generator_version, generator_commit, generator_dirty"
)
PART_COLUMNS = SUMMARY_COLUMNS + ", seed, code, tree, facts, labels, extra, embedding IS NOT NULL AS has_embedding, created_at"


class LimitRequestSize:
    """Refuses a query string over 2 KB (414) or a body over 64 KB (413), before any route sees it."""

    def __init__(self, app: ASGIApp, max_body: int = MAX_BODY_BYTES, max_query: int = MAX_QUERY_BYTES):
        self.app, self.max_body, self.max_query = app, max_body, max_query

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        if len(scope.get("query_string", b"")) > self.max_query:
            return await _plain(send, 414, "The address is too long.")
        length = dict(scope["headers"]).get(b"content-length")
        if length is not None and (not length.isdigit() or int(length) > self.max_body):
            return await _plain(send, 413, "The request body is too large.")

        received, started = 0, False

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_body:
                    raise _BodyTooLarge
            return message

        async def tracking_send(message: Message) -> None:
            nonlocal started
            started = started or message["type"] == "http.response.start"
            await send(message)

        try:
            await self.app(scope, limited_receive, tracking_send)
        except _BodyTooLarge:
            if not started:
                await _plain(send, 413, "The request body is too large.")


class _BodyTooLarge(Exception):
    pass


async def _plain(send: Send, status: int, message: str) -> None:
    response = JSONResponse({"error": message}, status_code=status)
    await response({"type": "http"}, _no_receive, send)


async def _no_receive() -> Message:
    return {"type": "http.disconnect"}


def create_app(settings: Settings | None = None) -> FastAPI:
    """The app. Settings are read when it starts, not when this module is imported."""

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        s = settings or get_settings()
        app.state.settings = s
        app.state.schema_expected = latest_version(s.migrations_dir)
        app.state.pool = make_pool(s)
        # Start even if the database is down: /health then says so, and the pool keeps trying.
        await app.state.pool.open(wait=False)
        try:
            yield
        finally:
            await app.state.pool.close()

    app = FastAPI(
        title="GKod API",
        version=__version__,
        summary="The parts library behind GKod: generated parts with their code, requests and print-check labels.",
        lifespan=lifespan,
    )
    app.add_middleware(LimitRequestSize)
    _add_error_handlers(app)
    _add_routes(app)
    return app


def _db(request: Request):
    """A pooled connection, taken inside the route so that a bad request never waits for the database."""
    return request.app.state.pool.connection()


ERRORS: dict[int | str, dict[str, Any]] = {
    422: {"model": Problem, "description": "A filter or id is not valid."},
    503: {"model": Problem, "description": "The database is not reachable."},
}


def _summary(row: dict) -> dict:
    return {
        **{k: row[k] for k in ("id", "run_id", "part_index", "family", "title", "request", "compile_ok",
                               "checks_ok", "split")},
        "generator": Generator(name=row["generator_name"], version=row["generator_version"],
                               commit=row["generator_commit"], dirty=row["generator_dirty"]),
    }


def _add_routes(app: FastAPI) -> None:
    @app.get("/", include_in_schema=False)
    async def root() -> dict:
        return {"name": "GKod API", "version": __version__, "endpoints": ["/health", "/parts", "/parts/{id}", "/stats"],
                "docs": "/docs"}

    @app.get("/health", response_model=Health, responses={503: {"model": Health, "description": "Not ready."}})
    async def health(request: Request, response: Response) -> Health:
        """The API is up; the database answers, has pgvector, and its schema is the one this code expects."""
        expected = request.app.state.schema_expected
        database, pgvector, version = "ok", None, None
        try:
            timeout = min(HEALTH_TIMEOUT_S, request.app.state.settings.db_timeout)
            async with request.app.state.pool.connection(timeout=timeout) as conn:
                row = await (await conn.execute(
                    "SELECT (SELECT extversion FROM pg_extension WHERE extname = 'vector') AS pgvector,"
                    " to_regclass('schema_migrations') IS NOT NULL AS has_migrations"
                )).fetchone()
                pgvector = row["pgvector"]
                if row["has_migrations"]:
                    version = (await (await conn.execute("SELECT max(version) AS v FROM schema_migrations")).fetchone())["v"]
        except (psycopg.Error, PoolTimeout):
            database = "unreachable"
        problems = []
        if database != "ok":
            problems.append("The database is not reachable.")
        else:
            if pgvector is None:
                problems.append("The pgvector extension is not installed in the database.")
            if version != expected:
                problems.append(
                    f"The database schema is at version {version or 0}; this code expects {expected}. "
                    "Run python -m gkod_api.migrate."
                )
        if problems:
            response.status_code = 503
        return Health(status="error" if problems else "ok", database=database, pgvector=pgvector,
                      schema_version=version, schema_expected=expected, problems=problems)

    @app.get("/parts", response_model=PartList, responses=ERRORS)
    async def list_parts(
        request: Request,
        family: Annotated[str | None, Query(max_length=64, description="Only this family, e.g. plate.")] = None,
        split: Annotated[Literal["train", "valid", "test", "none"] | None,
                         Query(description="Only this split; none means not split yet.")] = None,
        compile_ok: Annotated[bool | None, Query(description="Only parts that did (true) or did not compile.")] = None,
        checks_ok: Annotated[bool | None, Query(description="Only parts that passed (true) or failed the checks.")] = None,
        run: Annotated[str | None, Query(max_length=64, description="Only parts from this run.")] = None,
        limit: Annotated[int, Query(ge=1, le=MAX_LIMIT)] = 50,
        offset: Annotated[int, Query(ge=0, le=10_000_000)] = 0,
    ) -> PartList:
        """Parts in the order they were loaded, without their code. Filters combine with AND."""
        # Only fixed clause text goes into the SQL; every value is a parameter.
        clauses: list[str] = []
        params: list[Any] = []
        for column, value in (("family", family), ("run_id", run), ("compile_ok", compile_ok),
                              ("checks_ok", checks_ok)):
            if value is not None:
                clauses.append(f"{column} = %s")
                params.append(value)
        if split == "none":
            clauses.append("split IS NULL")
        elif split is not None:
            clauses.append("split = %s")
            params.append(split)
        where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
        async with _db(request) as conn:
            total = (await (await conn.execute(f"SELECT count(*) AS n FROM parts{where}", params)).fetchone())["n"]
            rows = await (await conn.execute(
                f"SELECT {SUMMARY_COLUMNS} FROM parts{where} ORDER BY id LIMIT %s OFFSET %s", [*params, limit, offset]
            )).fetchall()
        return PartList(items=[PartSummary(**_summary(r)) for r in rows], total=total, limit=limit, offset=offset)

    @app.get("/parts/{part_id}", response_model=Part,
             responses={404: {"model": Problem, "description": "No part has this id."}, **ERRORS})
    async def get_part(request: Request, part_id: Annotated[int, Path(ge=1, le=2**63 - 1)]) -> Part:
        """One part with its code, facts, tree and labels."""
        async with _db(request) as conn:
            row = await (await conn.execute(f"SELECT {PART_COLUMNS} FROM parts WHERE id = %s", (part_id,))).fetchone()
        if row is None:
            raise HTTPException(404, f"No part has the id {part_id}.")
        return Part(**_summary(row), **{k: row[k] for k in ("seed", "code", "tree", "facts", "labels", "extra",
                                                            "has_embedding", "created_at")})

    @app.get("/stats", response_model=Stats, responses={503: ERRORS[503]})
    async def stats(request: Request) -> Stats:
        """Counts of parts by family, split and label, and the runs they came from."""
        async with _db(request) as conn:
            return await _stats(conn)


async def _stats(conn: psycopg.AsyncConnection) -> Stats:
    async def counts(sql: str) -> list[dict]:
        return await (await conn.execute(sql)).fetchall()

    totals = (await counts("SELECT count(*) AS total, count(embedding) AS embedded FROM parts"))[0]
    by_family = {r["key"] or "unknown": r["n"] for r in await counts(
        "SELECT family AS key, count(*) AS n FROM parts GROUP BY family ORDER BY family NULLS LAST")}
    by_split = {r["key"] or "none": r["n"] for r in await counts(
        "SELECT split AS key, count(*) AS n FROM parts GROUP BY split ORDER BY split NULLS LAST")}
    by_label = {}
    for column in ("compile_ok", "checks_ok"):
        label = LabelCounts()
        for r in await counts(f"SELECT {column} AS key, count(*) AS n FROM parts GROUP BY {column}"):
            setattr(label, {True: "true", False: "false", None: "unknown"}[r["key"]], r["n"])
        by_label[column] = label
    runs = await counts(
        "SELECT r.*, (SELECT count(*) FROM parts p WHERE p.run_id = r.run_id) AS parts"
        " FROM runs r ORDER BY r.first_loaded_at, r.run_id"
    )
    return Stats(
        total=totals["total"], embedded=totals["embedded"], by_family=by_family, by_split=by_split,
        by_label=by_label, runs=[RunStats(**{k: r[k] for k in RunStats.model_fields}) for r in runs],
    )


def _add_error_handlers(app: FastAPI) -> None:
    def problem(status: int, message: str, headers: dict | None = None) -> JSONResponse:
        return JSONResponse({"error": message}, status_code=status, headers=headers)

    @app.exception_handler(HTTPException)
    async def http_error(request: Request, exc: HTTPException) -> JSONResponse:
        message = exc.detail if isinstance(exc.detail, str) else "The request failed."
        if exc.status_code == 404 and message == "Not Found":
            message = "There is nothing at this address. Try /health, /parts, /parts/{id} or /stats."
        elif exc.status_code == 405:
            message = "This address does not take that method."
        return problem(exc.status_code, message, getattr(exc, "headers", None))

    @app.exception_handler(RequestValidationError)
    async def invalid(request: Request, exc: RequestValidationError) -> JSONResponse:
        errors = exc.errors()
        first = errors[0] if errors else {}
        where = str(first["loc"][-1]) if first.get("loc") else "request"
        where = "id" if where == "part_id" else where
        msg = first.get("msg") or "Is not valid"
        return problem(422, f"{where}: {msg[0].lower()}{msg[1:]}.")

    @app.exception_handler(PoolTimeout)
    @app.exception_handler(psycopg.OperationalError)
    async def unreachable(request: Request, exc: Exception) -> JSONResponse:
        log.warning("database not reachable: %s", type(exc).__name__)
        return problem(503, "The parts database is not reachable right now.")

    @app.exception_handler(psycopg.errors.QueryCanceled)
    async def too_slow(request: Request, exc: Exception) -> JSONResponse:
        return problem(503, "The database took too long to answer.")

    @app.exception_handler(psycopg.errors.UndefinedTable)
    async def no_tables(request: Request, exc: Exception) -> JSONResponse:
        return problem(503, "The parts tables are missing. Run python -m gkod_api.migrate.")

    @app.exception_handler(Exception)
    async def crashed(request: Request, exc: Exception) -> JSONResponse:
        log.exception("unhandled error on %s %s", request.method, request.url.path)
        return problem(500, "Something went wrong on the server.")


app = create_app()
