"""Reading one generator row: what is kept, and why a row is refused.

A row is refused, with one fixed plain reason, when it cannot be traced to the generator that made it:
no generator name, version or commit, no seed, no index, no request or no code. It is also refused when it
is not a JSON object, a field is far too long, or its text cannot be stored. Everything else is read
defensively: a missing or oddly shaped optional field is stored as empty, never guessed.
"""

import json
import re
from dataclasses import dataclass, field
from typing import Any

MAX_LINE_BYTES = 1_000_000
MAX_CODE_CHARS = 200_000
MAX_REQUEST_CHARS = 4_000
MAX_TITLE_CHARS = 500
MAX_FAMILY_CHARS = 64
MAX_GENERATOR_FIELD_CHARS = 200

INT32_MAX = 2**31 - 1
INT64_MIN, INT64_MAX = -(2**63), 2**63 - 1

# A git commit id: 40 hex digits (SHA-1), 64 (SHA-256), or a short form of at least 7.
COMMIT = re.compile(r"^[0-9a-f]{7,64}$")

# The fields that have columns of their own. Any other top-level field is kept in `extra`.
KNOWN_FIELDS = {"generator", "seed", "index", "family", "tree", "request", "title", "facts", "code", "labels"}


class Refused(Exception):
    """The row is not loaded. `reason` is one of a small set of fixed phrases, so they can be counted."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class PartRow:
    generator_name: str
    generator_version: str
    generator_commit: str
    generator_dirty: bool | None
    seed: int
    part_index: int
    request: str
    code: str
    family: str | None = None
    title: str | None = None
    tree: dict | None = None
    facts: dict | list | None = None
    labels: dict = field(default_factory=dict)
    compile_ok: bool | None = None
    checks_ok: bool | None = None
    extra: dict = field(default_factory=dict)


def _no_constants(name: str) -> Any:
    raise ValueError(f"{name} is not allowed")


def strict_loads(text: str) -> Any:
    """json.loads, but NaN and Infinity (not JSON, and refused by jsonb) are errors."""
    return json.loads(text, parse_constant=_no_constants)


def parse_line(line: bytes | str) -> PartRow:
    """One line of parts.jsonl. Raises Refused."""
    size = len(line) if isinstance(line, bytes) else len(line.encode("utf-8", "surrogatepass"))
    if size > MAX_LINE_BYTES:
        raise Refused("line is longer than 1 MB")
    try:
        text = line.decode("utf-8") if isinstance(line, bytes) else line
        obj = strict_loads(text)
    except (UnicodeDecodeError, ValueError, RecursionError):
        raise Refused("not valid JSON") from None
    return parse_row(obj)


def parse_row(obj: Any) -> PartRow:
    """One decoded row. Raises Refused."""
    if not isinstance(obj, dict):
        raise Refused("not a JSON object")
    problem = bad_text(obj)
    if problem:
        raise Refused(problem)

    generator = obj.get("generator")
    if not isinstance(generator, dict):
        raise Refused("no generator")
    name = _required_text(generator.get("name"), "generator name", MAX_GENERATOR_FIELD_CHARS)
    version = _required_text(generator.get("version"), "generator version", MAX_GENERATOR_FIELD_CHARS)
    commit = _required_text(generator.get("commit"), "generator commit", MAX_GENERATOR_FIELD_CHARS)
    if not COMMIT.match(commit):
        raise Refused("generator commit is not a git commit id")
    dirty = generator.get("dirty")

    seed = _whole_number(obj.get("seed"), "seed", INT64_MIN, INT64_MAX)
    index = _whole_number(obj.get("index"), "index", 0, INT32_MAX)
    request = _required_text(obj.get("request"), "request", MAX_REQUEST_CHARS)
    code = _required_text(obj.get("code"), "code", MAX_CODE_CHARS, strip=False)

    labels = obj.get("labels") if isinstance(obj.get("labels"), dict) else {}
    compile_ok = _compile_ok(labels)
    checks_ok = _checks_ok(labels)
    if compile_ok is False and checks_ok is None:
        # A part that did not compile has no mesh to check, so it cannot have passed the checks.
        checks_ok = False

    facts = obj.get("facts")
    return PartRow(
        generator_name=name,
        generator_version=version,
        generator_commit=commit,
        generator_dirty=dirty if isinstance(dirty, bool) else None,
        seed=seed,
        part_index=index,
        request=request,
        code=code,
        family=_optional_text(obj.get("family"), "family", MAX_FAMILY_CHARS),
        title=_optional_text(obj.get("title"), "title", MAX_TITLE_CHARS),
        tree=obj.get("tree") if isinstance(obj.get("tree"), dict) else None,
        facts=facts if isinstance(facts, (dict, list)) else None,
        labels=labels,
        compile_ok=compile_ok,
        checks_ok=checks_ok,
        extra={k: v for k, v in obj.items() if k not in KNOWN_FIELDS},
    )


def _required_text(value: Any, what: str, limit: int, strip: bool = True) -> str:
    if value is None or (isinstance(value, str) and not value.strip()):
        raise Refused(f"no {what}")
    if not isinstance(value, str):
        raise Refused(f"{what} is not text")
    if len(value) > limit:
        raise Refused(f"{what} is longer than {limit:,} characters")
    return value.strip() if strip else value


def _optional_text(value: Any, what: str, limit: int) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    if len(value) > limit:
        raise Refused(f"{what} is longer than {limit:,} characters")
    return value.strip()


def _whole_number(value: Any, what: str, low: int, high: int) -> int:
    if value is None:
        raise Refused(f"no {what}")
    # bool is a kind of int in Python; true is not a seed. 7.0 is accepted, 7.5 is not.
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    if isinstance(value, bool) or not isinstance(value, int):
        raise Refused(f"{what} is not a whole number")
    if not low <= value <= high:
        raise Refused(f"{what} is out of range")
    return value


def _compile_ok(labels: dict) -> bool | None:
    """labels.compile_ok, or labels.compile.ok."""
    if isinstance(labels.get("compile_ok"), bool):
        return labels["compile_ok"]
    compile_ = labels.get("compile")
    if isinstance(compile_, dict) and isinstance(compile_.get("ok"), bool):
        return compile_["ok"]
    return None


def _checks_ok(labels: dict) -> bool | None:
    """labels.checks_ok, labels.checks.ok, or every check in labels.checks passed.

    The checks may be a list of {"id", "ok"} (also under "results"), or an object of id -> true/false or
    id -> {"ok": ...}. If any check's result cannot be read, the answer is unknown (None).
    """
    if isinstance(labels.get("checks_ok"), bool):
        return labels["checks_ok"]
    checks = labels.get("checks")
    if isinstance(checks, dict):
        if isinstance(checks.get("ok"), bool):
            return checks["ok"]
        if "results" in checks:
            checks = checks["results"]
    if isinstance(checks, dict):
        results = list(checks.values())
    elif isinstance(checks, list):
        results = checks
    else:
        return None
    oks = [r if isinstance(r, bool) else r.get("ok") if isinstance(r, dict) else None for r in results]
    if not oks or not all(isinstance(ok, bool) for ok in oks):
        return None
    return all(oks)


def bad_text(value: Any) -> str | None:
    """Why PostgreSQL could not store this JSON value's text, or None. Keys are checked too."""
    stack = [value]
    while stack:
        item = stack.pop()
        if isinstance(item, dict):
            stack.extend(item.keys())
            stack.extend(item.values())
        elif isinstance(item, list):
            stack.extend(item)
        elif isinstance(item, str):
            # text and jsonb cannot hold the NUL character.
            if "\x00" in item:
                return "text contains a NUL character"
            # A lone UTF-16 surrogate (from an escape such as \ud800) is not valid UTF-8.
            try:
                item.encode("utf-8")
            except UnicodeEncodeError:
                return "text is not valid Unicode"
    return None
