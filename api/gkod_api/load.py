"""Load the part generator's rows into the parts library.

    python -m gkod_api.load data/parts/<run>/parts.jsonl --run <name>

Rows go in in batches. A row without generator provenance (generator name, version and commit, seed,
index, request and code) is refused and counted with a plain reason; so is a row the database will not
store. The other rows still load, and the command then exits with 3. Loading the same file again adds nothing. If a manifest.json sits beside the
file, its sha256 is recorded with the run, and the file must match the sha256 the manifest gives for it.
"""

import argparse
import hashlib
import re
import sys
from collections import Counter
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb

from .db import connect, where
from .rows import MAX_LINE_BYTES, NumberTooLarge, PartRow, Refused, bad_text, parse_line, strict_loads
from .settings import SettingsError, get_settings

RUN_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
MAX_MANIFEST_BYTES = 10_000_000
DEFAULT_BATCH = 500
SOME_REFUSED = 3
NOT_STORED = "the database would not store this row"
# What the database raises for one bad row, as opposed to a problem with the connection or the tables.
ROW_ERRORS = (psycopg.DataError, psycopg.errors.CheckViolation)

INSERT_PART = """
INSERT INTO parts (
  run_id, generator_name, generator_version, generator_commit, generator_dirty, seed, part_index,
  family, request, title, tree, facts, code, labels, compile_ok, checks_ok, extra
)
VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
ON CONFLICT (run_id, part_index) DO NOTHING
"""


class LoadError(Exception):
    """The file cannot be loaded at all. Nothing was added. Plain message."""


@dataclass(frozen=True)
class Manifest:
    data: dict
    sha256: str


@dataclass
class ReadResult:
    rows: int = 0
    refused: Counter = field(default_factory=Counter)
    refused_lines: dict[str, list[int]] = field(default_factory=dict)

    def refuse(self, reason: str, line_no: int) -> None:
        self.refused[reason] += 1
        self.refused_lines.setdefault(reason, []).append(line_no)

    @property
    def accepted(self) -> int:
        return self.rows - self.refused.total()


@dataclass
class LoadReport:
    run: str
    source: str
    sha256: str
    manifest: Manifest | None
    read: ReadResult
    added: int | None = None  # None for a dry run
    matches_manifest: bool = False  # the manifest lists this file's sha256, and it matches

    def summary(self) -> str:
        out = [f"Read {self.read.rows} rows from {self.source} (sha256 {self.sha256[:12]})."]
        if self.manifest:
            kept = ", recorded with the run" if self.added is not None else ""
            listed = "lists this file's sha256, and it matches" if self.matches_manifest else (
                "does not list this file's sha256")
            out.append(f"manifest.json (sha256 {self.manifest.sha256[:12]}{kept}) {listed}.")
        else:
            out.append("No manifest.json beside the file.")
        if self.added is None:
            out.append(f'Checked only: {self.read.accepted} rows would be loaded as run "{self.run}".')
        else:
            already = self.read.accepted - self.added
            out.append(f'Run "{self.run}": added {self.added} parts; {already} were already there.')
        n = self.read.refused.total()
        out.append(f"Refused {n} row{'s' if n != 1 else ''}{':' if n else '.'}")
        for reason, count in self.read.refused.most_common():
            lines = self.read.refused_lines[reason]
            shown = ", ".join(str(x) for x in lines[:5]) + (", ..." if len(lines) > 5 else "")
            out.append(f"  {count:>5}  {reason} (line{'s' if len(lines) > 1 else ''} {shown})")
        return "\n".join(out)


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_manifest(parts_path: Path) -> Manifest | None:
    path = parts_path.parent / "manifest.json"
    if not path.is_file():
        return None
    if path.stat().st_size > MAX_MANIFEST_BYTES:
        raise LoadError("manifest.json beside the file is larger than 10 MB.")
    data = path.read_bytes()
    try:
        obj = strict_loads(data.decode("utf-8"))
    except NumberTooLarge:
        raise LoadError("manifest.json beside the file has a number too large to store.") from None
    except (UnicodeDecodeError, ValueError, RecursionError):
        raise LoadError("manifest.json beside the file is not valid JSON.") from None
    if not isinstance(obj, dict):
        raise LoadError("manifest.json beside the file is not a JSON object.")
    if bad_text(obj):
        raise LoadError(f"manifest.json beside the file has text the database cannot store: {bad_text(obj)}.")
    return Manifest(obj, hashlib.sha256(data).hexdigest())


def check_against_manifest(manifest: Manifest, parts_path: Path, sha256: str) -> bool:
    """If the manifest lists this file's sha256, the file must match it. True when it was listed."""
    files = manifest.data.get("files")
    entry = files.get(parts_path.name) if isinstance(files, dict) else None
    expected = entry.get("sha256") if isinstance(entry, dict) else None
    if isinstance(expected, str) and expected.lower() != sha256:
        raise LoadError(
            f"{parts_path.name} does not match manifest.json: its sha256 is {sha256[:12]}, the manifest says "
            f"{expected[:12]}. The file was changed after the generator wrote it, or the manifest is for another run."
        )
    return isinstance(expected, str)


def manifest_generator(manifest: Manifest | None) -> dict[str, str]:
    """The generator name, version and commit the manifest gives, where it gives them."""
    gen = manifest.data.get("generator") if manifest else None
    if not isinstance(gen, dict):
        return {}
    return {k: gen[k] for k in ("name", "version", "commit") if isinstance(gen.get(k), str) and gen[k]}


def iter_rows(path: Path, result: ReadResult, generator: dict[str, str] | None = None) -> Iterator[PartRow]:
    """The rows that pass, one at a time. Refused rows are counted in `result`. Blank lines are skipped."""
    for _, row in _numbered_rows(path, result, generator):
        yield row


def _numbered_rows(path: Path, result: ReadResult, generator: dict[str, str] | None) -> Iterator[tuple[int, PartRow]]:
    """iter_rows, with the line number of each row."""
    seen: set[int] = set()
    with path.open("rb") as f:
        line_no = 0
        while True:
            raw = f.readline(MAX_LINE_BYTES + 2)
            if not raw:
                break
            line_no += 1
            too_long = not raw.endswith(b"\n") and len(raw) > MAX_LINE_BYTES + 1
            while too_long and raw and not raw.endswith(b"\n"):
                raw = f.readline(1 << 20)  # skip the rest of a line too long to keep
            line = b"" if too_long else raw.rstrip(b"\r\n")
            if not too_long and not line.strip():
                continue
            result.rows += 1
            try:
                if too_long:
                    raise Refused("line is longer than 1 MB")
                row = parse_line(line)
                if row.part_index in seen:
                    raise Refused("index already used earlier in the file")
                actual = {"name": row.generator_name, "version": row.generator_version,
                          "commit": row.generator_commit}
                if generator and any(actual[k] != v for k, v in generator.items()):
                    raise Refused("generator differs from the one in manifest.json")
            except Refused as e:
                result.refuse(e.reason, line_no)
                continue
            seen.add(row.part_index)
            yield line_no, row


def _source_name(path: Path) -> str:
    # The folder and file name only: a full path would record where the file sat on someone's disk.
    return f"{path.parent.name}/{path.name}" if path.parent.name else path.name


def _prepare(path: Path, run: str) -> tuple[str, Manifest | None, bool]:
    if not RUN_NAME.match(run):
        raise LoadError(
            f"The run name {run!r} is not allowed: use up to 64 letters, digits, '.', '_' and '-', "
            "starting with a letter or digit."
        )
    if not path.is_file():
        raise LoadError(f"There is no file at {path}.")
    sha256 = file_sha256(path)
    manifest = read_manifest(path)
    matches = check_against_manifest(manifest, path, sha256) if manifest else False
    return sha256, manifest, matches


def check_file(path: Path, run: str) -> LoadReport:
    """Read and check the file without a database (--dry-run)."""
    sha256, manifest, matches = _prepare(path, run)
    result = ReadResult()
    for _ in iter_rows(path, result, manifest_generator(manifest)):
        pass
    return LoadReport(run, _source_name(path), sha256, manifest, result, None, matches)


def _claim_run(conn: psycopg.Connection, run: str, source: str, sha256: str, manifest: Manifest | None) -> None:
    """Record the run, or check that an existing run with this name came from this same file."""
    for other_run, other_sha in conn.execute(
        "SELECT run_id, file_sha256 FROM runs WHERE run_id = %s OR file_sha256 = %s", (run, sha256)
    ).fetchall():
        if other_run == run and other_sha != sha256:
            raise LoadError(f'Run "{run}" was loaded from a different file. Choose another --run name.')
        if other_run != run:
            raise LoadError(f'This file is already loaded, as run "{other_run}".')
    conn.execute(
        "INSERT INTO runs (run_id, source_file, file_sha256, manifest_sha256, manifest)"
        " VALUES (%s, %s, %s, %s, %s) ON CONFLICT (run_id) DO NOTHING",
        (run, source, sha256, manifest.sha256 if manifest else None, Jsonb(manifest.data) if manifest else None),
    )


def _params(run: str, row: PartRow) -> tuple:
    return (
        run, row.generator_name, row.generator_version, row.generator_commit, row.generator_dirty, row.seed,
        row.part_index, row.family, row.request, row.title,
        Jsonb(row.tree) if row.tree is not None else None,
        Jsonb(row.facts) if row.facts is not None else None,
        row.code, Jsonb(row.labels), row.compile_ok, row.checks_ok, Jsonb(row.extra),
    )


def _insert(conn: psycopg.Connection, batch: list[tuple]) -> int:
    with conn.transaction(), conn.cursor() as cur:
        cur.executemany(INSERT_PART, batch)
        return cur.rowcount


def _insert_batch(conn: psycopg.Connection, batch: list[tuple[int, tuple]], result: ReadResult) -> int:
    """Inserts a batch in one transaction. If the database refuses a value in it, the batch is inserted again
    one row at a time, and only the rows it refuses are left out (counted in `result`)."""
    try:
        return _insert(conn, [params for _, params in batch])
    except ROW_ERRORS:
        pass
    added = 0
    for line_no, params in batch:
        try:
            added += _insert(conn, [params])
        except ROW_ERRORS:
            result.refuse(NOT_STORED, line_no)
    return added


def load_file(conn: psycopg.Connection, path: Path, run: str, batch_size: int = DEFAULT_BATCH) -> LoadReport:
    """Load one generator file as one run. Each batch is its own transaction, so a load that stops halfway
    can simply be run again: rows already in are skipped by the (run_id, part_index) key."""
    sha256, manifest, matches = _prepare(path, run)
    source = _source_name(path)
    try:
        with conn.transaction():
            _claim_run(conn, run, source, sha256, manifest)
    except psycopg.errors.UniqueViolation:
        raise LoadError("Another load of this file or run name finished first. Run the command again.") from None

    result = ReadResult()
    added = 0
    batch: list[tuple[int, tuple]] = []
    for line_no, row in _numbered_rows(path, result, manifest_generator(manifest)):
        batch.append((line_no, _params(run, row)))
        if len(batch) >= batch_size:
            added += _insert_batch(conn, batch, result)
            batch = []
    if batch:
        added += _insert_batch(conn, batch, result)

    with conn.transaction():
        conn.execute(
            "UPDATE runs SET rows_read = %s, rows_refused = %s, refused = %s, last_loaded_at = now()"
            " WHERE run_id = %s",
            (result.rows, result.refused.total(), Jsonb(dict(result.refused)), run),
        )
    return LoadReport(run, source, sha256, manifest, result, added, matches)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m gkod_api.load", description=__doc__.split("\n")[0])
    parser.add_argument("file", type=Path, help="a parts.jsonl file written by the part generator")
    parser.add_argument("--run", help="a name for this run (default: the name of the file's folder)")
    parser.add_argument("--batch", type=int, default=DEFAULT_BATCH, help=f"rows per batch (default {DEFAULT_BATCH})")
    parser.add_argument("--dry-run", action="store_true", help="read and check the file only; no database needed")
    args = parser.parse_args(argv)
    if not 1 <= args.batch <= 10_000:
        parser.error("--batch must be between 1 and 10000")
    run = args.run if args.run is not None else args.file.resolve().parent.name

    settings = None
    try:
        if args.dry_run:
            report = check_file(args.file, run)
        else:
            settings = get_settings()
            with connect(settings) as conn:
                report = load_file(conn, args.file, run, args.batch)
    except (LoadError, SettingsError) as e:
        print(f"load: {e}", file=sys.stderr)
        return 1
    except psycopg.OperationalError as e:
        first = str(e).strip().splitlines()[0] if str(e).strip() else "no answer"
        print(f"load: could not reach {where(settings.database_url)}: {first}", file=sys.stderr)
        return 1
    except psycopg.errors.UndefinedTable:
        print("load: the parts tables are missing. Run python -m gkod_api.migrate first.", file=sys.stderr)
        return 1
    except psycopg.Error as e:
        first = str(e).strip().splitlines()[0] if str(e).strip() else type(e).__name__
        print(f"load: the database stopped the load: {first}. The batches before it are in; run the command "
              "again to finish.", file=sys.stderr)
        return 1
    print(report.summary())
    return SOME_REFUSED if report.read.refused else 0


if __name__ == "__main__":
    sys.exit(main())
