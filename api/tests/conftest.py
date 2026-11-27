"""Shared fixtures.

Tests that need a database ask for `db_url` (a new empty database) or `migrated_url` (the same with the
migrations applied). Each one is made on the Postgres server that DATABASE_URL points at and dropped at the
end, so the data already in that database is never touched. The user in DATABASE_URL needs CREATEDB, which
the compose and CI users have. Without DATABASE_URL these tests are skipped and the rest still run.
"""

import os
import uuid
from pathlib import Path

import psycopg
import pytest
from psycopg import sql
from psycopg.conninfo import make_conninfo

from gkod_api.migrate import migrate
from gkod_api.settings import DEFAULT_MIGRATIONS

FIXTURES = Path(__file__).parent / "fixtures"

NO_DATABASE = (
    "DATABASE_URL is not set, so the database tests are skipped. Start the database with "
    "'npm run api:up' and set DATABASE_URL as in .env.example to run them."
)


@pytest.fixture(scope="session")
def server_url() -> str:
    url = os.environ.get("DATABASE_URL", "").strip()
    if not url:
        pytest.skip(NO_DATABASE)
    return url


@pytest.fixture
def make_db(server_url):
    """Returns a function that makes a new empty database and gives its connection string."""
    made: list[str] = []

    def make() -> str:
        name = f"gkod_test_{uuid.uuid4().hex[:12]}"
        with psycopg.connect(server_url, autocommit=True) as conn:
            conn.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
        made.append(name)
        return make_conninfo(server_url, dbname=name)

    yield make
    with psycopg.connect(server_url, autocommit=True) as conn:
        for name in made:
            conn.execute(sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(sql.Identifier(name)))


@pytest.fixture
def db_url(make_db) -> str:
    return make_db()


@pytest.fixture
def migrated_url(db_url) -> str:
    with psycopg.connect(db_url) as conn:
        migrate(conn, DEFAULT_MIGRATIONS)
    return db_url


@pytest.fixture
def use_db(monkeypatch):
    """Points DATABASE_URL (read by the commands and the API) at the given database."""

    def use(url: str) -> str:
        monkeypatch.setenv("DATABASE_URL", url)
        return url

    return use
