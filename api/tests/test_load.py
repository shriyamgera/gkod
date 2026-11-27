"""The load command: reading a whole file, the manifest, and loading into the database."""

import hashlib
import json
import shutil
from pathlib import Path

import psycopg
import pytest

from gkod_api import load as load_cmd
from gkod_api import rows as rows_mod
from gkod_api.load import NOT_STORED, LoadError, ReadResult, check_file, iter_rows, load_file
from gkod_api.rows import MAX_LINE_BYTES

FIXTURES = Path(__file__).parent / "fixtures"
RUN_FILE = FIXTURES / "parts" / "fixture-run" / "parts.jsonl"
REFUSED_FILE = FIXTURES / "refused.jsonl"

REFUSED_REASONS = {
    "no generator": [2],
    "no generator commit": [3],
    "generator commit is not a git commit id": [4],
    "no seed": [5],
    "seed is not a whole number": [6],
    "no index": [7],
    "index is out of range": [8],
    "no request": [9],
    "no code": [10],
    "not valid JSON": [11],
    "not a JSON object": [12],
    "index already used earlier in the file": [13],
    "no generator version": [16],
    "no generator name": [17],
    "a number is too large to store": [18],
}


@pytest.fixture
def run_copy(tmp_path):
    """A copy of the fixture run's folder, safe to change."""
    folder = tmp_path / "copy-run"
    shutil.copytree(RUN_FILE.parent, folder)
    return folder / "parts.jsonl"


# Without a database


def test_the_fixture_manifest_matches_its_file():
    manifest = json.loads((RUN_FILE.parent / "manifest.json").read_text())
    assert manifest["files"]["parts.jsonl"]["sha256"] == hashlib.sha256(RUN_FILE.read_bytes()).hexdigest()


def test_each_refused_row_is_counted_with_its_reason_and_line():
    result = ReadResult()
    kept = list(iter_rows(REFUSED_FILE, result))
    assert [r.part_index for r in kept] == [0, 1]
    assert result.rows == 17  # 18 lines, one blank
    assert result.refused_lines == REFUSED_REASONS
    assert result.accepted == 2


def test_a_dry_run_checks_the_whole_run_and_its_manifest():
    report = check_file(RUN_FILE, "fixture-run")
    assert (report.read.rows, report.read.accepted, report.added) == (8, 8, None)
    assert report.matches_manifest
    assert report.source == "fixture-run/parts.jsonl"
    assert "lists this file's sha256, and it matches" in report.summary()


def test_a_file_that_does_not_match_its_manifest_is_not_loaded(run_copy):
    with run_copy.open("a") as f:
        f.write("\n")
    with pytest.raises(LoadError, match="does not match manifest.json"):
        check_file(run_copy, "copy-run")


def test_a_manifest_that_is_not_json_is_a_plain_error(run_copy):
    (run_copy.parent / "manifest.json").write_text("{not json")
    with pytest.raises(LoadError, match="manifest.json beside the file is not valid JSON"):
        check_file(run_copy, "copy-run")


def test_a_manifest_without_a_file_list_is_still_recorded(run_copy):
    (run_copy.parent / "manifest.json").write_text(json.dumps({"seed": 7}))
    report = check_file(run_copy, "copy-run")
    assert report.manifest is not None and not report.matches_manifest
    assert "does not list this file's sha256" in report.summary()


def test_rows_from_another_generator_than_the_manifest_names_are_refused(run_copy):
    manifest_path = run_copy.parent / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["generator"]["commit"] = "f" * 40
    manifest_path.write_text(json.dumps(manifest))
    report = check_file(run_copy, "copy-run")
    assert report.read.refused == {"generator differs from the one in manifest.json": 8}


def test_a_line_too_long_to_keep_is_skipped_and_the_next_line_still_read(tmp_path):
    path = tmp_path / "long" / "parts.jsonl"
    path.parent.mkdir()
    good = RUN_FILE.read_bytes().splitlines()[0]
    path.write_bytes(b"x" * (MAX_LINE_BYTES * 2 + 5) + b"\n" + good + b"\n")
    result = ReadResult()
    kept = list(iter_rows(path, result))
    assert [r.part_index for r in kept] == [0]
    assert result.refused_lines == {"line is longer than 1 MB": [1]}


@pytest.mark.parametrize("name", ["", "-run", "a b", "run/1", "x" * 65, "run;drop"])
def test_odd_run_names_are_refused(name):
    with pytest.raises(LoadError, match="is not allowed"):
        check_file(RUN_FILE, name)


def test_a_missing_file_is_a_plain_error(tmp_path):
    with pytest.raises(LoadError, match="There is no file at"):
        check_file(tmp_path / "parts.jsonl", "r")


def test_the_command_exits_3_when_rows_were_refused(capsys):
    assert load_cmd.main([str(REFUSED_FILE), "--dry-run", "--run", "bad"]) == 3
    out = capsys.readouterr().out
    assert "Refused 15 rows:" in out
    assert "no generator commit (line 3)" in out


def test_the_run_name_defaults_to_the_folder_name(capsys):
    assert load_cmd.main([str(RUN_FILE), "--dry-run"]) == 0
    assert 'as run "fixture-run"' in capsys.readouterr().out


def test_the_command_needs_database_url_unless_it_is_a_dry_run(monkeypatch, capsys):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    assert load_cmd.main([str(RUN_FILE)]) == 1
    assert "DATABASE_URL is not set" in capsys.readouterr().err


# With a database


def count(url, sql="SELECT count(*) FROM parts"):
    with psycopg.connect(url) as conn:
        return conn.execute(sql).fetchone()[0]


def test_loading_the_same_file_again_adds_nothing(migrated_url):
    with psycopg.connect(migrated_url) as conn:
        first = load_file(conn, RUN_FILE, "fixture-run", batch_size=3)
        second = load_file(conn, RUN_FILE, "fixture-run", batch_size=3)
    assert first.added == 8
    assert second.added == 0
    assert "8 were already there" in second.summary()
    assert count(migrated_url) == 8


def test_a_load_that_stopped_halfway_is_finished_by_running_it_again(migrated_url):
    with psycopg.connect(migrated_url) as conn:
        load_file(conn, RUN_FILE, "fixture-run")
        conn.execute("DELETE FROM parts WHERE part_index >= 5")
        conn.commit()
        again = load_file(conn, RUN_FILE, "fixture-run", batch_size=2)
    assert again.added == 3
    assert count(migrated_url) == 8


def test_the_run_records_the_file_and_manifest_hashes(migrated_url):
    with psycopg.connect(migrated_url) as conn:
        load_file(conn, RUN_FILE, "fixture-run")
        run = conn.execute(
            "SELECT source_file, file_sha256, manifest_sha256, manifest->>'seed', rows_read, rows_refused FROM runs"
        ).fetchone()
    assert run == (
        "fixture-run/parts.jsonl",
        hashlib.sha256(RUN_FILE.read_bytes()).hexdigest(),
        hashlib.sha256((RUN_FILE.parent / "manifest.json").read_bytes()).hexdigest(),
        "7",
        8,
        0,
    )


def test_refused_rows_are_not_loaded_and_their_reasons_are_kept(migrated_url):
    with psycopg.connect(migrated_url) as conn:
        report = load_file(conn, REFUSED_FILE, "refused")
        refused = conn.execute("SELECT refused FROM runs WHERE run_id = 'refused'").fetchone()[0]
        indexes = [r[0] for r in conn.execute("SELECT part_index FROM parts ORDER BY part_index")]
    assert report.added == 2
    assert indexes == [0, 1]
    assert refused == {reason: len(lines) for reason, lines in REFUSED_REASONS.items()}


def test_the_labels_and_fields_land_in_their_columns(migrated_url):
    with psycopg.connect(migrated_url) as conn:
        load_file(conn, RUN_FILE, "fixture-run")
        rows = conn.execute(
            "SELECT part_index, family, compile_ok, checks_ok, generator_commit, seed, extra->>'part_seed',"
            " jsonb_typeof(facts), labels->'compile'->>'error' FROM parts ORDER BY part_index"
        ).fetchall()
    assert [(r[1], r[2], r[3]) for r in rows] == [
        ("plate", True, True), ("hook", True, True), ("tray", True, True), ("clip", True, True),
        ("plate", True, False), ("knob", False, False), ("spacer", True, True), ("bracket", True, True),
    ]
    assert {r[4] for r in rows} == {"0123456789abcdef0123456789abcdef01234567"}
    assert {r[5] for r in rows} == {7}
    assert rows[6][6] == "2913377"
    assert rows[3][7] == "object" and rows[0][7] == "array"
    assert rows[5][8] == "Parser error in line 13: syntax error"


def test_a_row_the_database_will_not_store_is_refused_and_the_rest_of_its_batch_still_loads(
    migrated_url, tmp_path, monkeypatch
):
    path = tmp_path / "odd" / "parts.jsonl"
    path.parent.mkdir()
    lines = RUN_FILE.read_text().splitlines()[:3]
    lines[1] = lines[1].replace('"tree":{', '"tree":{"x":1e400,', 1)
    path.write_text("\n".join(lines) + "\n")
    # Let the too-large number past the row rules, as a value they do not foresee would be.
    monkeypatch.setattr(rows_mod, "strict_loads", json.loads)
    monkeypatch.setattr(rows_mod, "bad_text", lambda value: None)
    with psycopg.connect(migrated_url) as conn:
        report = load_file(conn, path, "odd")
        indexes = [r[0] for r in conn.execute("SELECT part_index FROM parts ORDER BY part_index")]
        refused = conn.execute("SELECT rows_read, rows_refused, refused FROM runs").fetchone()
    assert report.added == 2
    assert report.read.refused_lines == {NOT_STORED: [2]}
    assert indexes == [0, 2]
    assert refused == (3, 1, {NOT_STORED: 1})


def test_a_database_error_during_the_load_is_a_plain_message(migrated_url, use_db, monkeypatch, capsys):
    def no_permission(*args, **kwargs):
        raise psycopg.errors.InsufficientPrivilege("permission denied for table parts")

    monkeypatch.setattr(load_cmd, "load_file", no_permission)
    use_db(migrated_url)
    assert load_cmd.main([str(RUN_FILE)]) == 1
    err = capsys.readouterr().err
    assert err.startswith("load: the database stopped the load: permission denied for table parts.")
    assert "Traceback" not in err


def test_one_run_name_cannot_hold_two_files(migrated_url, run_copy):
    with run_copy.open("a") as f:
        f.write("\n")
    (run_copy.parent / "manifest.json").unlink()
    with psycopg.connect(migrated_url) as conn:
        load_file(conn, RUN_FILE, "fixture-run")
        with pytest.raises(LoadError, match="was loaded from a different file"):
            load_file(conn, run_copy, "fixture-run")


def test_one_file_cannot_be_loaded_as_two_runs(migrated_url):
    with psycopg.connect(migrated_url) as conn:
        load_file(conn, RUN_FILE, "fixture-run")
        with pytest.raises(LoadError, match='already loaded, as run "fixture-run"'):
            load_file(conn, RUN_FILE, "another-name")
    assert count(migrated_url) == 8


def test_the_command_loads_and_reports(migrated_url, use_db, capsys):
    use_db(migrated_url)
    assert load_cmd.main([str(RUN_FILE), "--run", "fixture-run"]) == 0
    assert 'Run "fixture-run": added 8 parts; 0 were already there.' in capsys.readouterr().out
    assert load_cmd.main([str(RUN_FILE), "--run", "fixture-run"]) == 0
    assert "added 0 parts; 8 were already there" in capsys.readouterr().out


def test_the_command_says_to_migrate_first_on_an_empty_database(db_url, use_db, capsys):
    use_db(db_url)
    assert load_cmd.main([str(RUN_FILE)]) == 1
    assert "Run python -m gkod_api.migrate first" in capsys.readouterr().err
