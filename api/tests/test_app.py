"""The HTTP API, through FastAPI's test client."""

from pathlib import Path

import psycopg
import pytest
from fastapi.testclient import TestClient

from gkod_api.app import create_app
from gkod_api.load import load_file
from gkod_api.migrate import latest_version
from gkod_api.settings import DEFAULT_MIGRATIONS, Settings, SettingsError, get_settings

RUN_FILE = Path(__file__).parent / "fixtures" / "parts" / "fixture-run" / "parts.jsonl"
# Nothing listens on port 1, so connecting fails at once.
NO_SERVER = "postgresql://gkod:pw@127.0.0.1:1/gkod"


def client_for(url: str, **settings) -> TestClient:
    return TestClient(create_app(Settings(database_url=url, **settings)), raise_server_exceptions=False)


@pytest.fixture
def loaded_url(migrated_url):
    with psycopg.connect(migrated_url) as conn:
        load_file(conn, RUN_FILE, "fixture-run")
    return migrated_url


@pytest.fixture
def api(loaded_url):
    with client_for(loaded_url) as client:
        yield client


def sql(url: str, statement: str, params=()) -> None:
    with psycopg.connect(url) as conn:
        conn.execute(statement, params)


# Settings


def test_settings_say_what_to_set_when_database_url_is_missing():
    with pytest.raises(SettingsError, match="DATABASE_URL is not set"):
        get_settings({})


def test_settings_read_the_environment():
    s = get_settings({"DATABASE_URL": " postgresql://x@h/db ", "GKOD_DB_POOL_MAX": "8", "GKOD_MIGRATIONS": "/m"})
    assert (s.database_url, s.pool_max, str(s.migrations_dir)) == ("postgresql://x@h/db", 8, "/m")
    assert get_settings({"DATABASE_URL": "x"}).migrations_dir == DEFAULT_MIGRATIONS


@pytest.mark.parametrize("value, message", [("many", "must be a whole number"), ("0", "must be between 1 and 50")])
def test_wrong_settings_are_plain_errors(value, message):
    with pytest.raises(SettingsError, match=message):
        get_settings({"DATABASE_URL": "x", "GKOD_DB_POOL_MAX": value})


# Without a database


def test_health_says_the_database_is_unreachable_and_answers_503():
    with client_for(NO_SERVER, db_timeout=1) as client:
        response = client.get("/health")
    assert response.status_code == 503
    body = response.json()
    assert (body["status"], body["api"], body["database"]) == ("error", "ok", "unreachable")
    assert body["problems"] == ["The database is not reachable."]
    assert body["schema_expected"] == latest_version(DEFAULT_MIGRATIONS)


def test_other_routes_answer_503_in_plain_words_when_the_database_is_down():
    with client_for(NO_SERVER, db_timeout=1) as client:
        response = client.get("/stats")
    assert response.status_code == 503
    assert response.json() == {"error": "The parts database is not reachable right now."}


def test_a_large_body_is_refused_before_any_route():
    with client_for(NO_SERVER) as client:
        response = client.post("/parts", content=b"a" * 70_000)
    assert response.status_code == 413
    assert response.json() == {"error": "The request body is too large."}


def test_a_long_address_is_refused():
    with client_for(NO_SERVER) as client:
        response = client.get("/parts", params={"family": "a" * 3000})
    assert response.status_code == 414


@pytest.mark.parametrize(
    "path, status, error",
    [
        ("/parts?limit=201", 422, "limit: input should be less than or equal to 200."),
        ("/parts?limit=0", 422, "limit: input should be greater than or equal to 1."),
        ("/parts?offset=-1", 422, "offset: input should be greater than or equal to 0."),
        ("/parts?split=holdout", 422, "split: input should be 'train', 'valid', 'test' or 'none'."),
        ("/parts?compile_ok=maybe", 422, "compile_ok: input should be a valid boolean, unable to interpret input."),
        ("/parts/abc", 422, "id: input should be a valid integer, unable to parse string as an integer."),
        ("/parts/0", 422, "id: input should be greater than or equal to 1."),
        ("/nowhere", 404, "There is nothing at this address. Try /health, /parts, /parts/{id} or /stats."),
    ],
)
def test_bad_requests_get_plain_errors_without_touching_the_database(path, status, error):
    with client_for(NO_SERVER) as client:
        response = client.get(path)
    assert (response.status_code, response.json()) == (status, {"error": error})


def test_other_methods_are_refused():
    with client_for(NO_SERVER) as client:
        response = client.delete("/parts/1")
    assert (response.status_code, response.json()) == (405, {"error": "This address does not take that method."})


# With a database


def test_health_is_ok_on_a_migrated_database(migrated_url):
    with client_for(migrated_url) as client:
        response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok" and body["database"] == "ok" and body["problems"] == []
    assert body["pgvector"]
    assert body["schema_version"] == body["schema_expected"] == latest_version(DEFAULT_MIGRATIONS)


def test_health_names_what_is_missing_before_migrations(db_url):
    with client_for(db_url) as client:
        response = client.get("/health")
    assert response.status_code == 503
    body = response.json()
    assert (body["database"], body["pgvector"], body["schema_version"]) == ("ok", None, None)
    assert body["problems"][0] == "The pgvector extension is not installed in the database."
    assert "Run python -m gkod_api.migrate" in body["problems"][1]


def test_parts_answer_503_with_a_hint_before_migrations(db_url):
    with client_for(db_url) as client:
        response = client.get("/parts")
    assert response.status_code == 503
    assert response.json() == {"error": "The parts tables are missing. Run python -m gkod_api.migrate."}


def test_parts_are_listed_in_load_order_without_their_code(api):
    body = api.get("/parts").json()
    assert (body["total"], body["limit"], body["offset"]) == (8, 50, 0)
    assert [p["part_index"] for p in body["items"]] == list(range(8))
    first = body["items"][0]
    assert first["family"] == "plate" and first["run_id"] == "fixture-run" and first["split"] is None
    assert first["generator"] == {"name": "gkod-datagen", "version": "0.1.0",
                                  "commit": "0123456789abcdef0123456789abcdef01234567", "dirty": False}
    assert "code" not in first


def test_limit_and_offset_page_through_the_parts(api):
    body = api.get("/parts", params={"limit": 3, "offset": 3}).json()
    assert body["total"] == 8
    assert [p["part_index"] for p in body["items"]] == [3, 4, 5]
    assert api.get("/parts", params={"offset": 100}).json()["items"] == []


@pytest.mark.parametrize(
    "params, indexes",
    [
        ({"family": "plate"}, [0, 4]),
        ({"compile_ok": "false"}, [5]),
        ({"checks_ok": "false"}, [4, 5]),
        ({"checks_ok": "true", "family": "plate"}, [0]),
        ({"compile_ok": "true", "checks_ok": "false"}, [4]),
        ({"run": "fixture-run", "family": "hook"}, [1]),
        ({"run": "other-run"}, []),
        ({"split": "none"}, list(range(8))),
        ({"split": "train"}, []),
        ({"family": "plate' OR '1'='1"}, []),
    ],
)
def test_filters(api, params, indexes):
    body = api.get("/parts", params=params).json()
    assert [p["part_index"] for p in body["items"]] == indexes
    assert body["total"] == len(indexes)


def test_the_split_filter_once_parts_are_split(api, loaded_url):
    sql(loaded_url, "UPDATE parts SET split = CASE WHEN part_index < 6 THEN 'train' ELSE 'test' END"
                    " WHERE part_index <> 7")
    assert [p["part_index"] for p in api.get("/parts?split=test").json()["items"]] == [6]
    assert [p["part_index"] for p in api.get("/parts?split=none").json()["items"]] == [7]
    assert api.get("/stats").json()["by_split"] == {"test": 1, "train": 6, "none": 1}


def test_one_part_has_its_code_facts_and_labels(api):
    first_id = api.get("/parts?limit=1").json()["items"][0]["id"]
    part = api.get(f"/parts/{first_id}").json()
    assert part["title"] == "Backing plate with two holes"
    assert part["code"].startswith("// Backing plate with two holes\n")
    assert part["facts"][0] == {"key": "width", "value": 60, "unit": "mm"}
    assert part["tree"]["family"] == "plate"
    assert part["labels"]["compile"]["ok"] is True
    assert part["extra"] == {"id": "s7-000000"}
    assert part["seed"] == 7
    assert part["has_embedding"] is False
    assert part["created_at"]


def test_a_missing_part_is_a_plain_404(api):
    response = api.get("/parts/999999")
    assert (response.status_code, response.json()) == (404, {"error": "No part has the id 999999."})


def test_stats_count_by_family_split_and_label(api):
    stats = api.get("/stats").json()
    assert stats["total"] == 8
    assert stats["embedded"] == 0
    assert stats["by_family"] == {"bracket": 1, "clip": 1, "hook": 1, "knob": 1, "plate": 2, "spacer": 1, "tray": 1}
    assert stats["by_split"] == {"none": 8}
    assert stats["by_label"] == {"compile_ok": {"true": 7, "false": 1, "unknown": 0},
                                 "checks_ok": {"true": 6, "false": 2, "unknown": 0}}
    (run,) = stats["runs"]
    assert (run["run_id"], run["parts"], run["rows_read"], run["rows_refused"]) == ("fixture-run", 8, 8, 0)
    assert run["source_file"] == "fixture-run/parts.jsonl"
    assert len(run["file_sha256"]) == 64 and len(run["manifest_sha256"]) == 64


def test_an_embedding_shows_in_the_part_and_the_stats(api, loaded_url):
    sql(loaded_url, "UPDATE parts SET embedding = array_fill(0.5, ARRAY[384])::vector WHERE part_index = 2")
    part_id = api.get("/parts?limit=1&offset=2").json()["items"][0]["id"]
    assert api.get(f"/parts/{part_id}").json()["has_embedding"] is True
    assert api.get("/stats").json()["embedded"] == 1


def test_stats_on_an_empty_library(migrated_url):
    with client_for(migrated_url) as client:
        stats = client.get("/stats").json()
    assert stats["total"] == 0 and stats["by_family"] == {} and stats["runs"] == []
    assert stats["by_label"]["compile_ok"] == {"true": 0, "false": 0, "unknown": 0}
