"""What the scorer measures on a mesh: its box, volume, whether it is closed, how many pieces it has and its genus.

The genus of one closed body is its number of through holes (tunnels): a plate with four holes has genus 4. It is
worked out from the Euler characteristic, V - E + F = 2 - 2g, after joining corners closer than 0.0001 mm, the same
tolerance the print checks use.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np

JOIN_MM = 1e-4


@dataclass(frozen=True)
class MeshInfo:
    triangles: int
    min: tuple[float, float, float]
    size: tuple[float, float, float]
    volume: float
    # every edge is shared by exactly two triangles that run along it in opposite directions
    closed: bool
    # separate pieces, joined through shared corners
    shells: int
    # set only for one closed piece
    genus: int | None

    def as_dict(self) -> dict:
        return asdict(self)


def _faces(tri: np.ndarray) -> tuple[np.ndarray, int]:
    """Corner indices after joining corners, with faces that collapsed to a line or point left out."""
    keys = np.round(tri.reshape(-1, 3) / JOIN_MM).astype(np.int64)
    _, inverse = np.unique(keys, axis=0, return_inverse=True)
    faces = inverse.reshape(-1, 3)
    keep = (faces[:, 0] != faces[:, 1]) & (faces[:, 1] != faces[:, 2]) & (faces[:, 0] != faces[:, 2])
    return faces[keep], int(inverse.max()) + 1 if len(inverse) else 0


def _labels(edges: np.ndarray, count: int) -> np.ndarray:
    """Connected component label of every corner (the smallest index in its piece)."""
    labels = np.arange(count, dtype=np.int64)
    if not len(edges):
        return labels
    u, v = edges[:, 0], edges[:, 1]
    while True:
        low = np.minimum(labels[u], labels[v])
        before = labels.copy()
        np.minimum.at(labels, u, low)
        np.minimum.at(labels, v, low)
        # pointer jumping: follow labels to their roots so long chains settle in a few passes
        while True:
            jumped = labels[labels]
            if np.array_equal(jumped, labels):
                break
            labels = jumped
        if np.array_equal(labels, before):
            return labels


def measure(triangles: np.ndarray) -> MeshInfo:
    tri = np.asarray(triangles, dtype=np.float64).reshape(-1, 3, 3)
    if len(tri) == 0:
        return MeshInfo(0, (0.0, 0.0, 0.0), (0.0, 0.0, 0.0), 0.0, False, 0, None)
    flat = tri.reshape(-1, 3)
    low, high = flat.min(axis=0), flat.max(axis=0)
    volume = float(np.einsum("ij,ij->i", tri[:, 0], np.cross(tri[:, 1], tri[:, 2])).sum() / 6.0)

    faces, count = _faces(tri)
    directed = faces[:, [0, 1, 1, 2, 2, 0]].reshape(-1, 2)
    codes = directed[:, 0] * count + directed[:, 1]
    unique_codes = np.unique(codes)
    reverse = directed[:, 1] * count + directed[:, 0]
    closed = bool(len(faces)) and len(unique_codes) == len(codes) and bool(np.isin(reverse, unique_codes).all())

    undirected = np.unique(np.sort(directed, axis=1), axis=0)
    used = np.unique(faces)
    labels = _labels(undirected, count)
    shells = int(len(np.unique(labels[used])))
    genus = None
    if closed and shells == 1:
        euler = len(used) - len(undirected) + len(faces)
        if euler % 2 == 0 and euler <= 2:
            genus = (2 - euler) // 2
    return MeshInfo(
        triangles=len(tri),
        min=tuple(float(x) for x in low),
        size=tuple(float(x) for x in high - low),
        volume=abs(volume),
        closed=closed,
        shells=shells,
        genus=genus,
    )
