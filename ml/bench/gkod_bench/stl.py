"""Reads and writes STL files as an (n, 3, 3) array of triangle corners in mm."""

from __future__ import annotations

import struct
from pathlib import Path

import numpy as np

_RECORD = np.dtype([("normal", "<f4", (3,)), ("corners", "<f4", (3, 3)), ("attr", "<u2")])


class StlError(ValueError):
    """The file is not an STL this reader understands."""


def parse_stl(data: bytes) -> np.ndarray:
    """Triangles from binary STL bytes (what the compiler writes), or from ASCII STL as a fallback."""
    if len(data) >= 84:
        (count,) = struct.unpack_from("<I", data, 80)
        if len(data) == 84 + 50 * count:
            records = np.frombuffer(data, dtype=_RECORD, count=count, offset=84)
            return records["corners"].astype(np.float64)
    head = data[:512].lstrip().lower()
    if head.startswith(b"solid"):
        return _parse_ascii(data.decode("ascii", errors="replace"))
    raise StlError("not a binary STL (the size does not match its triangle count) and not an ASCII STL")


def _parse_ascii(text: str) -> np.ndarray:
    corners = []
    for line in text.splitlines():
        parts = line.split()
        if len(parts) == 4 and parts[0].lower() == "vertex":
            corners.append([float(v) for v in parts[1:]])
    if len(corners) % 3:
        raise StlError("an ASCII STL whose vertex count is not a multiple of three")
    return np.asarray(corners, dtype=np.float64).reshape(-1, 3, 3)


def read_stl(path: str | Path) -> np.ndarray:
    return parse_stl(Path(path).read_bytes())


def stl_bytes(triangles: np.ndarray) -> bytes:
    """A binary STL of the triangles, with normals worked out from the corner order."""
    tri = np.asarray(triangles, dtype=np.float64).reshape(-1, 3, 3)
    normals = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    lengths = np.linalg.norm(normals, axis=1, keepdims=True)
    normals = np.divide(normals, lengths, out=np.zeros_like(normals), where=lengths > 0)
    records = np.zeros(len(tri), dtype=_RECORD)
    records["normal"] = normals
    records["corners"] = tri
    return b"\0" * 80 + struct.pack("<I", len(tri)) + records.tobytes()


def write_stl(path: str | Path, triangles: np.ndarray) -> None:
    Path(path).write_bytes(stl_bytes(triangles))
