"""Database connections: one at a time for the commands, a pool for the API."""

import time

import psycopg
from psycopg.conninfo import conninfo_to_dict
from psycopg_pool import AsyncConnectionPool

from .settings import Settings

CONNECT_TIMEOUT_S = 5


def _connect_kwargs(settings: Settings) -> dict:
    return {
        "connect_timeout": CONNECT_TIMEOUT_S,
        "options": f"-c statement_timeout={settings.statement_timeout_ms}",
        "application_name": "gkod-api",
    }


def where(database_url: str) -> str:
    """Host, port and database name of a connection string, without the user or password."""
    try:
        parts = conninfo_to_dict(database_url)
    except psycopg.ProgrammingError:
        return "the database in DATABASE_URL"
    host = parts.get("host") or "localhost"
    port = parts.get("port") or "5432"
    return f"{host}:{port}/{parts.get('dbname') or parts.get('user') or ''}"


def connect(settings: Settings, wait_s: float = 0) -> psycopg.Connection:
    """Open one connection, trying again for up to wait_s seconds while the database starts."""
    deadline = time.monotonic() + wait_s
    while True:
        try:
            return psycopg.connect(settings.database_url, **_connect_kwargs(settings))
        except psycopg.OperationalError:
            if time.monotonic() >= deadline:
                raise
            time.sleep(1)


def make_pool(settings: Settings) -> AsyncConnectionPool:
    """A pool that is not open yet. The API opens it on start without waiting for the database."""
    return AsyncConnectionPool(
        settings.database_url,
        min_size=1,
        max_size=settings.pool_max,
        kwargs=_connect_kwargs(settings),
        timeout=settings.db_timeout,
        # Throw away connections the server closed, for example after a database restart.
        check=AsyncConnectionPool.check_connection,
        open=False,
        name="gkod-api",
    )
