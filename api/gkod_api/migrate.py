"""Apply the SQL migrations in api/migrations, in order, each one once.

    python -m gkod_api.migrate

Applied versions are recorded in the schema_migrations table with each file's sha256, so running it again
does nothing, and a file that was changed after it was applied is refused.
"""

import argparse
import hashlib
import re
import sys
from dataclasses import dataclass
from pathlib import Path

import psycopg

from .db import connect, where
from .settings import SettingsError, get_settings

FILE_NAME = re.compile(r"^(\d{4})_([a-z0-9_]+)\.sql$")

# Held for the whole run so two copies of the command (two API containers, say) cannot both migrate.
LOCK_KEY = 0x676B6F64  # "gkod"


class MigrationError(Exception):
    """The migrations folder or the database's record of it is not as expected. Plain message."""


@dataclass(frozen=True)
class Migration:
    version: int
    name: str
    path: Path
    sql: str
    sha256: str


def find_migrations(folder: Path) -> list[Migration]:
    if not folder.is_dir():
        raise MigrationError(f"There is no migrations folder at {folder}.")
    found: dict[int, Migration] = {}
    for path in sorted(folder.glob("*.sql")):
        match = FILE_NAME.match(path.name)
        if not match:
            raise MigrationError(f"{path.name} is not named like 0001_name.sql.")
        version = int(match.group(1))
        if version == 0:
            raise MigrationError(f"{path.name}: numbering starts at 0001.")
        if version in found:
            raise MigrationError(f"{path.name} and {found[version].path.name} have the same number.")
        data = path.read_bytes()
        found[version] = Migration(
            version, match.group(2), path, data.decode("utf-8"), hashlib.sha256(data).hexdigest()
        )
    return [found[v] for v in sorted(found)]


def latest_version(folder: Path) -> int | None:
    migrations = find_migrations(folder)
    return migrations[-1].version if migrations else None


def migrate(conn: psycopg.Connection, folder: Path) -> list[Migration]:
    """Apply what is missing, all in one transaction. Returns the migrations applied now."""
    migrations = find_migrations(folder)
    known = {m.version: m for m in migrations}
    done: list[Migration] = []
    with conn.transaction():
        conn.execute("SELECT pg_advisory_xact_lock(%s)", (LOCK_KEY,))
        conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations ("
            " version integer PRIMARY KEY,"
            " name text NOT NULL,"
            " sha256 text NOT NULL,"
            " applied_at timestamptz NOT NULL DEFAULT now())"
        )
        applied = dict(conn.execute("SELECT version, sha256 FROM schema_migrations").fetchall())
        for version, sha in sorted(applied.items()):
            if version not in known:
                raise MigrationError(
                    f"The database has migration {version:04d}, which is not in {folder}. "
                    "It was applied by a newer copy of the code."
                )
            if sha != known[version].sha256:
                raise MigrationError(
                    f"{known[version].path.name} was changed after it was applied. "
                    "Put the change in a new numbered file instead."
                )
        for m in migrations:
            if m.version in applied:
                continue
            # The whole file in one call: with no parameters, psycopg sends it as one simple query.
            conn.execute(m.sql)
            conn.execute(
                "INSERT INTO schema_migrations (version, name, sha256) VALUES (%s, %s, %s)",
                (m.version, m.name, m.sha256),
            )
            done.append(m)
    return done


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m gkod_api.migrate", description=__doc__.split("\n")[0])
    parser.add_argument(
        "--wait", type=float, default=30, metavar="SECONDS",
        help="keep trying to reach the database for this long (default 30)",
    )
    args = parser.parse_args(argv)
    try:
        settings = get_settings()
        with connect(settings, wait_s=max(0.0, args.wait)) as conn:
            done = migrate(conn, settings.migrations_dir)
            version = conn.execute("SELECT max(version) FROM schema_migrations").fetchone()[0]
    except (SettingsError, MigrationError) as e:
        print(f"migrate: {e}", file=sys.stderr)
        return 1
    except psycopg.OperationalError as e:
        first = str(e).strip().splitlines()[0] if str(e).strip() else "no answer"
        print(f"migrate: could not reach {where(settings.database_url)}: {first}", file=sys.stderr)
        return 1
    except psycopg.Error as e:
        print(f"migrate: the database refused a migration: {str(e).strip().splitlines()[0]}", file=sys.stderr)
        return 1
    if done:
        names = ", ".join(m.path.name for m in done)
        print(f"Applied {len(done)} migration{'s' if len(done) != 1 else ''}: {names}. Schema version {version}.")
    else:
        print(f"The schema is up to date (version {version}).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
