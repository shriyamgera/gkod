# The GKod API: FastAPI on uvicorn, plus the migrate and load commands.
FROM python:3.12.13-slim-trixie

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONPATH=/app

WORKDIR /app

# Only the pinned packages (no resolver extras), then a check that nothing they need is missing.
COPY requirements.txt .
RUN python -m pip install --no-deps -r requirements.txt && python -m pip check

RUN useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin gkod

COPY gkod_api ./gkod_api
COPY migrations ./migrations

USER gkod
EXPOSE 8000

# 0.0.0.0 inside the container so the published port reaches it; docker-compose.yml publishes it on
# 127.0.0.1 only.
CMD ["uvicorn", "gkod_api.app:app", "--host", "0.0.0.0", "--port", "8000", "--no-server-header"]
