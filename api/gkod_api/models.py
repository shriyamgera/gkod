"""The shapes of the API's answers."""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

Split = Literal["train", "valid", "test"]


class Problem(BaseModel):
    error: str = Field(description="What went wrong, in plain words.")


class Health(BaseModel):
    status: Literal["ok", "error"]
    api: Literal["ok"] = "ok"
    database: Literal["ok", "unreachable"]
    pgvector: str | None = Field(description="Version of the pgvector extension, or null if it is missing.")
    schema_version: int | None = Field(description="Latest migration applied to the database.")
    schema_expected: int | None = Field(description="Latest migration this code ships.")
    problems: list[str] = Field(default_factory=list)


class Generator(BaseModel):
    name: str
    version: str
    commit: str
    dirty: bool | None


class PartSummary(BaseModel):
    id: int
    run_id: str
    part_index: int
    family: str | None
    title: str | None
    request: str
    compile_ok: bool | None
    checks_ok: bool | None
    split: Split | None
    generator: Generator


class Part(PartSummary):
    seed: int
    code: str
    tree: dict[str, Any] | None
    facts: dict[str, Any] | list[Any] | None
    labels: dict[str, Any]
    extra: dict[str, Any]
    has_embedding: bool
    created_at: datetime


class PartList(BaseModel):
    items: list[PartSummary]
    total: int = Field(description="How many parts match the filters, before limit and offset.")
    limit: int
    offset: int


class LabelCounts(BaseModel):
    true: int = 0
    false: int = 0
    unknown: int = 0


class RunStats(BaseModel):
    run_id: str
    parts: int
    rows_read: int
    rows_refused: int
    refused: dict[str, int]
    source_file: str
    file_sha256: str
    manifest_sha256: str | None
    first_loaded_at: datetime
    last_loaded_at: datetime


class Stats(BaseModel):
    total: int
    embedded: int = Field(description="Parts with an embedding (filled from day 8).")
    by_family: dict[str, int] = Field(description="Parts per family; a part with no family counts as 'unknown'.")
    by_split: dict[str, int] = Field(description="Parts per split; parts not split yet count as 'none'.")
    by_label: dict[str, LabelCounts] = Field(description="compile_ok and checks_ok: true, false or unknown.")
    runs: list[RunStats]
