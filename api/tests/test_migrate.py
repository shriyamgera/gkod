import shutil

import psycopg
import pytest

from gkod_api import migrate as migrate_cmd
from gkod_api.migrate import MigrationError, find_migrations, latest_version, migrate
from gkod_api.settings import DEFAULT_MIGRATIONS


# Without a database


def test_the_shipped_migrations_are_numbered_from_one_without_gaps():
    versions = [m.version for m in find_migrations(DEFAULT_MIGRATIONS)]
    assert versions == list(range(1, len(versions) + 1))
    assert latest_version(DEFAULT_MIGRATIONS) == versions[-1]


@pytest.mark.parametrize(
    "names, message",
    [
        (["1_parts.sql"], "is not named like 0001_name.sql"),
        (["0001_Parts.sql"], "is not named like 0001_name.sql"),
        (["0000_start.sql"], "numbering starts at 0001"),
        (["0001_a.sql", "0001_b.sql"], "have the same number"),
    ],
)
def test_badly_named_migration_files_are_refused(tmp_path, names, message):
    for name in names:
        (tmp_path / name).write_text("SELECT 1;")
    with pytest.raises(MigrationError, match=message):
        find_migrations(tmp_path)


def test_a_missing_folder_is_a_plain_error(tmp_path):
    with pytest.raises(MigrationError, match="There is no migrations folder"):
        find_migrations(tmp_path / "nope")


def test_migrations_are_ordered_by_number_not_by_name(tmp_path):
    (tmp_path / "0010_later.sql").write_text("SELECT 10;")
    (tmp_path / "0002_sooner.sql").write_text("SELECT 2;")
    assert [m.version for m in find_migrations(tmp_path)] == [2, 10]


def test_the_command_says_what_to_set_when_database_url_is_missing(monkeypatch, capsys):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    assert migrate_cmd.main([]) == 1
    assert "DATABASE_URL is not set" in capsys.readouterr().err


def test_the_command_names_the_server_but_not_the_password_when_it_cannot_connect(monkeypatch, capsys):
    monkeypatch.setenv("DATABASE_URL", "postgresql://gkod:secret-pw@127.0.0.1:1/gkod")
    assert migrate_cmd.main(["--wait", "0"]) == 1
    err = capsys.readouterr().err
    assert "could not reach 127.0.0.1:1/gkod" in err
    assert "secret-pw" not in err


# With a database


def test_migrate_applies_everything_once_and_again_does_nothing(db_url):
    with psycopg.connect(db_url) as conn:
        first = migrate(conn, DEFAULT_MIGRATIONS)
        second = migrate(conn, DEFAULT_MIGRATIONS)
        rows = conn.execute("SELECT version, name FROM schema_migrations ORDER BY version").fetchall()
        vector = conn.execute("SELECT extversion FROM pg_extension WHERE extname = 'vector'").fetchone()
    shipped = find_migrations(DEFAULT_MIGRATIONS)
    assert [m.version for m in first] == [m.version for m in shipped]
    assert second == []
    assert rows == [(m.version, m.name) for m in shipped]
    assert vector is not None


def test_the_parts_table_has_the_columns_the_api_reads(migrated_url):
    with psycopg.connect(migrated_url) as conn:
        columns = dict(
            conn.execute(
                "SELECT attname, format_type(atttypid, atttypmod) FROM pg_attribute"
                " WHERE attrelid = 'parts'::regclass AND attnum > 0 AND NOT attisdropped"
            ).fetchall()
        )
    assert columns["embedding"] == "vector(384)"
    assert columns["facts"] == "jsonb" and columns["labels"] == "jsonb"
    for name in ["run_id", "generator_name", "generator_version", "generator_commit", "seed", "part_index",
                 "family", "request", "title", "code", "compile_ok", "checks_ok", "split", "created_at"]:
        assert name in columns


def test_the_database_itself_refuses_a_part_without_a_generator_commit(migrated_url):
    with psycopg.connect(migrated_url) as conn:
        conn.execute("INSERT INTO runs (run_id, source_file, file_sha256) VALUES ('r', 'f', %s)", ("a" * 64,))
        with pytest.raises(psycopg.errors.CheckViolation):
            conn.execute(
                "INSERT INTO parts (run_id, generator_name, generator_version, generator_commit, seed,"
                " part_index, request, code) VALUES ('r', 'gen', '1', '', 1, 0, 'a plate', 'cube(1);')"
            )


def test_a_new_migration_is_applied_after_the_old_ones(db_url, tmp_path):
    folder = tmp_path / "migrations"
    shutil.copytree(DEFAULT_MIGRATIONS, folder)
    with psycopg.connect(db_url) as conn:
        migrate(conn, folder)
        next_version = latest_version(folder) + 1
        (folder / f"{next_version:04d}_note.sql").write_text("ALTER TABLE parts ADD COLUMN note text;")
        done = migrate(conn, folder)
        assert [m.version for m in done] == [next_version]
        assert conn.execute("SELECT count(*) FROM schema_migrations").fetchone()[0] == next_version


def test_a_migration_changed_after_it_was_applied_is_refused(db_url, tmp_path):
    folder = tmp_path / "migrations"
    shutil.copytree(DEFAULT_MIGRATIONS, folder)
    with psycopg.connect(db_url) as conn:
        migrate(conn, folder)
        first = find_migrations(folder)[0].path
        first.write_text(first.read_text() + "\n-- edited\n")
        with pytest.raises(MigrationError, match="was changed after it was applied"):
            migrate(conn, folder)


def test_a_failed_migration_leaves_nothing_behind(db_url, tmp_path):
    folder = tmp_path / "migrations"
    folder.mkdir()
    (folder / "0001_half.sql").write_text("CREATE TABLE half (x int); SELECT no_such_function();")
    with psycopg.connect(db_url) as conn:
        with pytest.raises(psycopg.errors.UndefinedFunction):
            migrate(conn, folder)
        assert conn.execute("SELECT to_regclass('half'), to_regclass('schema_migrations')").fetchone() == (None, None)


def test_the_command_reports_up_to_date_on_the_second_run(db_url, use_db, capsys):
    use_db(db_url)
    assert migrate_cmd.main([]) == 0
    assert "Applied" in capsys.readouterr().out
    assert migrate_cmd.main([]) == 0
    assert "up to date" in capsys.readouterr().out
