"""The site's rule for finding the code in an answer (app/src/engine/extract.ts and app/src/scad/guard.ts), line for
line, so every row is read the same way the site reads it. tests/fixtures/extract_cases.json holds cases with the
site's own results: pytest runs them here and tools/test/bench-fixtures.test.ts runs them through the site's code.

Regular expressions use JavaScript's meanings: \\w and \\b are ASCII only and \\s is JavaScript's whitespace.
"""

from __future__ import annotations

import re

MAX_CODE_BYTES = 40_000

NO_CODE_MESSAGE = "Gemini did not send any OpenSCAD code. Try again, or say it another way."
TOO_LONG_MESSAGE = "Gemini sent more code than a part needs, so it was not used. Try again."

# JavaScript's \s and String.prototype.trim: WhiteSpace and LineTerminator
_JS_SPACE = "\t\n\v\f\r                  　﻿"
_S = "[" + re.escape(_JS_SPACE) + "]"

_FENCE_OPEN = re.compile(r"^[ \t]*```[ \t]*([\w+-]*)", re.ASCII)
_FENCE_CLOSE = re.compile(r"^[ \t]*```[ \t]*$", re.ASCII)
_SCAD_TAGS = {"openscad", "scad"}

_SHAPES = re.compile(
    r"\b(cube|cylinder|sphere|polygon|polyhedron|square|circle|linear_extrude|rotate_extrude|hull|difference|union)"
    + _S
    + r"*\(",
    re.ASCII,
)
_CODE_START = re.compile(
    r"^(//|/\*|\$?\w+" + _S + r"*=|module\b|function\b|"
    r"(translate|rotate|scale|mirror|difference|union|intersection|hull|linear_extrude|rotate_extrude|cube|cylinder|sphere)"
    + _S
    + r"*\()",
    re.ASCII,
)
_BANNED_CALL = re.compile(r"(?<![\w$])(minkowski|text)" + _S + r"*\(", re.ASCII)
BANNED = {
    "minkowski": "minkowski() is not supported here because it is very slow. Use hull() instead.",
    "text": "text() is not supported yet because no font is loaded.",
}


def js_trim(text: str) -> str:
    return text.strip(_JS_SPACE)


def _fenced_blocks(text: str) -> list[tuple[str, str]]:
    """Every fenced block with its language tag. A block cut off at the end still counts."""
    lines = text.split("\n")
    blocks = []
    i = 0
    while i < len(lines):
        opened = _FENCE_OPEN.match(lines[i])
        if opened:
            end = i + 1
            while end < len(lines) and not _FENCE_CLOSE.match(lines[end]):
                end += 1
            blocks.append((opened.group(1).lower(), "\n".join(lines[i + 1 : end])))
            i = end
        i += 1
    return blocks


def _code_block(text: str) -> str | None:
    """The first block marked as OpenSCAD; failing that, the first one not marked at all."""
    blocks = _fenced_blocks(text)
    for tag, body in blocks:
        if tag in _SCAD_TAGS:
            return body
    for tag, body in blocks:
        if tag == "":
            return body
    return None


def _looks_like_scad(text: str) -> bool:
    """With no fence, the whole answer is used only when it reads as code from its first line."""
    first = text.lstrip(_JS_SPACE).split("\n", 1)[0]
    return bool(_SHAPES.search(text)) and ";" in text and bool(_CODE_START.match(first))


def _strip_comments_and_strings(source: str) -> str:
    out = []
    i = 0
    n = len(source)
    while i < n:
        two = source[i : i + 2]
        if two == "//":
            end = source.find("\n", i)
            i = n if end < 0 else end
        elif two == "/*":
            end = source.find("*/", i + 2)
            i = n if end < 0 else end + 2
            out.append(" ")
        elif source[i] == '"':
            i += 1
            while i < n and source[i] != '"':
                i += 2 if source[i] == "\\" else 1
            i += 1
            out.append('""')
        else:
            out.append(source[i])
            i += 1
    return "".join(out)


def find_banned_call(source: str) -> str | None:
    """A message when the code calls something version 1 does not allow, otherwise None."""
    match = _BANNED_CALL.search(_strip_comments_and_strings(source))
    return BANNED[match.group(1)] if match else None


def extract_code(answer: str) -> dict:
    """{ok: True, code} or {ok: False, problem: no-code | too-long | blocked, message, code (blocked only)}."""
    text = re.sub(r"\r\n?", "\n", answer)
    code = _code_block(text)
    if code is None and _looks_like_scad(text):
        code = text
    code = js_trim(code) if code is not None else ""
    if not code:
        return {"ok": False, "problem": "no-code", "message": NO_CODE_MESSAGE}
    if len(code.encode("utf-8", "surrogatepass")) > MAX_CODE_BYTES:
        return {"ok": False, "problem": "too-long", "message": TOO_LONG_MESSAGE}
    code += "\n"
    banned = find_banned_call(code)
    if banned:
        return {"ok": False, "problem": "blocked", "message": banned, "code": code}
    return {"ok": True, "code": code}
