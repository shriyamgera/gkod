"""Training configs: TOML files in ml/configs. A file may name another one with `extends` (a path next to it); its
tables are merged over that file's, key by key, so a run's file holds only what its method changes."""

from __future__ import annotations

import hashlib
import json
import tomllib
from pathlib import Path

ML = Path(__file__).resolve().parents[1]
REPO = ML.parent
CONFIGS = ML / "configs"


def merge(base: dict, over: dict) -> dict:
    """`over` on top of `base`: tables merge key by key, anything else is replaced."""
    out = dict(base)
    for key, value in over.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = merge(out[key], value)
        else:
            out[key] = value
    return out


def load_config(path: str | Path, _seen: tuple[Path, ...] = ()) -> dict:
    """The merged config, with `files`: every file read (base first) and its sha256, for the run record."""
    path = Path(path).resolve()
    if path in _seen:
        raise ValueError(f"{path.name} extends itself through {' -> '.join(p.name for p in _seen)}")
    raw = path.read_bytes()
    data = tomllib.loads(raw.decode("utf-8"))
    if "files" in data:
        raise ValueError(f"{path.name}: 'files' is filled in by the loader; do not set it")
    parent = data.pop("extends", None)
    files = []
    if parent:
        base = load_config(path.parent / parent, (*_seen, path))
        files = base.pop("files")
        data = merge(base, data)
    files.append({"file": display(path), "sha256": hashlib.sha256(raw).hexdigest()})
    data["files"] = files
    return data


def display(path: Path) -> str:
    """A path relative to the repo when it is inside it."""
    path = Path(path).resolve()
    return str(path.relative_to(REPO)) if path.is_relative_to(REPO) else str(path)


def repo_path(value: str | Path) -> Path:
    """A path from a config or the command line: absolute as given, otherwise from the repo root."""
    path = Path(value)
    return path if path.is_absolute() else REPO / path


def canonical_sha256(value) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
