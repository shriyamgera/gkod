# GKod backend

A small Python service (package `gkod_api`) in front of the **parts library**: the parts the GKod part generator makes, each with its request, its OpenSCAD code, its facts and the results of compiling it and running the print checks. It is FastAPI on uvicorn, with PostgreSQL 17 and pgvector, reached through psycopg 3 and its connection pool. It runs on your own machine with Docker Compose; nothing here is deployed.

## What it does today

- **Keeps the parts library** in PostgreSQL. Plain SQL migrations in [migrations/](migrations/) build it; `python -m gkod_api.migrate` applies each one once.
- **Loads the generator's output.** `python -m gkod_api.load` reads a `parts.jsonl` file in batches. A row that does not name the generator that made it is refused, so every part in the library can be traced to its source (details below). Loading the same file again adds nothing.
- **Answers four read-only endpoints**: health, the parts with filters, one part, and counts.

## What comes later

- **Day 7:** the train, valid and test split is filled in (the `split` column is there already, empty).
- **Day 8:** embeddings of each request from a small Hugging Face model, stored in the `embedding` column (384 numbers, pgvector), and a search endpoint over them.
- **Day 9:** the fine-tuned GKod model behind the API. The model server (mlx-lm) runs on the Mac itself, not in Docker; the API will call it.

## Run it with Docker Compose

Needs Docker with Compose v2. From the repository root:

```sh
cp .env.example .env        # once; change the password if you like
docker compose up -d --build --wait
curl http://127.0.0.1:8000/health
```

`npm run api:up` does the first two steps, and `npm run api:down` stops everything. `docker compose down -v` also deletes the database volume, for a clean start.

Two services start:

- **db**: `pgvector/pgvector:0.8.7-pg17-trixie`, data in the named volume `gkod-db`, published on `127.0.0.1:5432` (`GKOD_DB_PORT` changes the port).
- **api**: built from [Dockerfile](Dockerfile) (`python:3.12.13-slim-trixie`, pinned requirements, a non-root user, a read-only file system). It waits until the database is healthy, runs the migrations, then starts uvicorn, published on `127.0.0.1:8000` (`GKOD_API_PORT`). Its healthcheck calls `/health`.

Both are published on 127.0.0.1 only, so nothing on your network can reach them. The password in `.env.example` is for this local setup only; `.env` itself is git-ignored.

## Load parts

The part generator writes `data/parts/<run>/parts.jsonl`, with a `manifest.json` beside it. With the stack up, from the repository root:

```sh
export DATABASE_URL=postgresql://gkod:gkod-local-dev@127.0.0.1:5432/gkod   # as in .env.example
python -m gkod_api.load data/parts/<run>/parts.jsonl --run <name>
```

(That needs the package installed; see [Run from your own shell](#run-from-your-own-shell). To use the API image instead, mount the folder: `docker compose run --rm -v "$PWD/data:/data:ro" api python -m gkod_api.load /data/parts/<run>/parts.jsonl --run <name>`.)

- `--run` names the run; it defaults to the file's folder name. `--batch` sets the rows per batch (500). `--dry-run` reads and checks the file without a database. `--no-manifest` loads a file that has no `manifest.json` beside it (see below).
- **A row is refused** when it has no generator name, version or commit (the commit must be a git commit id), no seed, no index (a whole number, 0 or more), no request or no code. It is also refused if it is not a JSON object, uses an index already used earlier in the file, comes from a different generator than the manifest names, has a field far too long to be a real part, or has text or a number PostgreSQL cannot store (a number such as 1e400 is too large). If the database still turns a row down, only that row is refused; the rest of its batch loads. Each refusal is counted with its reason and line numbers, printed, and kept with the run. The good rows still load, and the command exits with 3 so a script notices.
- **Loading again adds nothing**: parts are keyed by run and index. A load that stopped halfway can simply be run again.
- **One run is one file.** The run records the file's sha256, and the sha256 of `manifest.json` if there is one. A run name already used for a different file is refused, and so is a file already loaded under another name.
- **The manifest is required and checked.** The generator writes `manifest.json` last, so a file without one may still be being written, or the run may have stopped early: it is refused unless you pass `--no-manifest`. The file must match the sha256 and the row count the manifest lists for it, or nothing is loaded.
- Fields are read defensively. `labels` may say `compile.ok` or `compile_ok`; the checks may be `checks.ok`, a list of results or an object of results. `compile_ok` and `checks_ok` get columns of their own for filtering; when a result cannot be read it is stored as unknown, never guessed. Fields without a column (such as the generator's own row id) are kept in `extra`.

## Endpoints

Every answer is JSON. Every error is `{"error": "<plain words>"}`. The full schema is at `/docs` while the API runs.

| Endpoint | What it answers |
|---|---|
| `GET /health` | `"status": "ok"` when the API is up, the database answers, pgvector is installed and the schema is at the version the code expects. Otherwise 503, with each problem in plain words. |
| `GET /parts` | Parts in load order, without their code: `items`, `total` (matching the filters), `limit`, `offset`. Filters, combined with AND: `family`, `split` (`train`, `valid`, `test`, or `none` for not split yet), `compile_ok`, `checks_ok` (`true` or `false`) and `run`. `limit` is 1 to 200 (50 by default); `offset` starts at 0. |
| `GET /parts/{id}` | One part: everything in the list, plus its seed, code, tree, facts, labels, `extra`, whether it has an embedding, and when it was loaded. 404 if there is no such part. |
| `GET /stats` | Counts: `total`, `embedded`, `by_family`, `by_split`, `by_label` (true, false and unknown for `compile_ok` and `checks_ok`), and each run with its parts, refused rows and hashes. |

Limits: a query string over 2 KB is refused (414), a request body over 64 KB is refused (413), and a bad filter gets a plain 422 (`run` must be a run name as the loader allows it, and `family` may not hold control characters). All SQL is parameterised. Each statement may run for 10 seconds. `/health` answers within 2 seconds even when the database is down or has stopped answering (paused, or the network path to it gone). Every other request gives up after the wait for a connection plus the statement time limit (15 seconds with the defaults) and answers 503.

## Run from your own shell

For the loader, the tests, or the API without Docker. Needs Python 3.12:

```sh
python3.12 -m venv api/.venv
api/.venv/bin/python -m pip install -r api/requirements-dev.txt -e api
export DATABASE_URL=postgresql://gkod:gkod-local-dev@127.0.0.1:5432/gkod
api/.venv/bin/python -m gkod_api.migrate
api/.venv/bin/uvicorn gkod_api.app:app --host 127.0.0.1 --port 8000
```

If making the virtualenv or running pip fails with `Symbol not found: _XML_SetAllocTrackerActivationThreshold`, put `DYLD_LIBRARY_PATH="$(brew --prefix expat)/lib"` in front of those two commands (see [mcp/README.md](../mcp/README.md)).

Settings, all from the environment:

| Variable | Default | What it sets |
|---|---|---|
| `DATABASE_URL` | (required) | The parts database. |
| `GKOD_DB_POOL_MAX` | 5 | Most database connections the API keeps open. |
| `GKOD_DB_TIMEOUT` | 5 | Seconds to wait for a connection before answering 503. |
| `GKOD_STATEMENT_TIMEOUT_MS` | 10000 | Longest one SQL statement may run. |
| `GKOD_MIGRATIONS` | `api/migrations` | Where the migration files are. |

## Tests

```sh
api/.venv/bin/python -m pytest api
```

The tests of the loader's rules, the settings and the request limits need no database. The others (migrations applied once, a changed migration refused, loading twice adds nothing, the filters, health, stats) run against the PostgreSQL server that `DATABASE_URL` points at: each test makes its own empty database there and drops it afterwards, so your data is not touched. The user needs permission to create databases, which the compose user has. Without `DATABASE_URL` those tests are skipped and say why.

CI runs the same tests against a pgvector service container, then builds the image, starts the stack with Docker Compose, checks `/health`, loads the test run and reads it back.

## Files

- `gkod_api/app.py`: the endpoints, the request limits and the plain error answers. `models.py`: the answer shapes.
- `gkod_api/load.py`: the load command. `rows.py`: how one row is read and when it is refused.
- `gkod_api/migrate.py`: the migrate command. `migrations/`: the SQL, numbered `0001_name.sql` and never edited once applied.
- `gkod_api/db.py`, `settings.py`: connections and settings.
- `tests/fixtures/`: a small run in the generator's format, with its manifest, and a file of rows that must be refused.
