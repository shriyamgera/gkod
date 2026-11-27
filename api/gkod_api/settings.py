"""Settings for the API, the loader and the migrate command, read from the environment."""

import os
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

# api/migrations, next to the package. GKOD_MIGRATIONS points somewhere else.
DEFAULT_MIGRATIONS = Path(__file__).resolve().parent.parent / "migrations"


class SettingsError(Exception):
    """A setting is missing or wrong. The message is plain enough to show as it is."""


@dataclass(frozen=True)
class Settings:
    database_url: str
    # Most connections the API keeps open to the database.
    pool_max: int = 5
    # Seconds to wait for a database connection before answering "not reachable".
    db_timeout: float = 5.0
    # Longest a single SQL statement may run.
    statement_timeout_ms: int = 10_000
    migrations_dir: Path = DEFAULT_MIGRATIONS


def _int(env: Mapping[str, str], name: str, default: int, low: int, high: int) -> int:
    raw = env.get(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        raise SettingsError(f"{name} must be a whole number, not {raw!r}.") from None
    if not low <= value <= high:
        raise SettingsError(f"{name} must be between {low} and {high}, not {value}.")
    return value


def get_settings(env: Mapping[str, str] | None = None) -> Settings:
    env = os.environ if env is None else env
    url = env.get("DATABASE_URL", "").strip()
    if not url:
        raise SettingsError(
            "DATABASE_URL is not set. Point it at the parts database, for example "
            "postgresql://gkod:<password>@127.0.0.1:5432/gkod (see .env.example)."
        )
    migrations = env.get("GKOD_MIGRATIONS", "").strip()
    return Settings(
        database_url=url,
        pool_max=_int(env, "GKOD_DB_POOL_MAX", 5, 1, 50),
        db_timeout=float(_int(env, "GKOD_DB_TIMEOUT", 5, 1, 60)),
        statement_timeout_ms=_int(env, "GKOD_STATEMENT_TIMEOUT_MS", 10_000, 100, 600_000),
        migrations_dir=Path(migrations) if migrations else DEFAULT_MIGRATIONS,
    )
