"""Shape overlap: voxel intersection over union of two meshes after lining up their bounding-box min corners.

Each mesh is filled on the same grid by casting a ray up every column of voxel centres and counting crossings:
a centre is inside between an odd and the next even crossing. The grid is a little off the round numbers parts
are drawn on, so a ray never runs exactly along an edge. The voxel size is the longest side of the two boxes
divided by `resolution` (200 by default: 1 mm voxels for a 200 mm part, a fraction of a second per part).
"""

from __future__ import annotations

import math

import numpy as np

RESOLUTION = 200
# fractions of a voxel; irrational, so grid points do not land on part corners drawn at round numbers
_JITTER = (math.sqrt(2) - 1.4142) * 10, (math.sqrt(3) - 1.7320) * 10
_MAX_PAIRS = 4_000_000


def fill(tri: np.ndarray, pitch: float, shape: tuple[int, int, int]) -> np.ndarray:
    """Occupancy of a grid whose corner is at the origin, voxel centres at (i + 0.5) * pitch (plus the jitter)."""
    nx, ny, nz = shape
    grid = np.zeros((nx, ny, nz + 1), dtype=np.int16)
    tri = np.asarray(tri, dtype=np.float64).reshape(-1, 3, 3)
    a, b, c = tri[:, 0], tri[:, 1], tri[:, 2]
    area = (b[:, 0] - a[:, 0]) * (c[:, 1] - a[:, 1]) - (b[:, 1] - a[:, 1]) * (c[:, 0] - a[:, 0])
    keep = np.abs(area) > 1e-12
    a, b, c, area = a[keep], b[keep], c[keep], area[keep]
    jx, jy = _JITTER
    # the columns whose centre can be inside each triangle's shadow on the bed
    xs = np.stack([a[:, 0], b[:, 0], c[:, 0]], axis=1) / pitch - 0.5 - jx
    ys = np.stack([a[:, 1], b[:, 1], c[:, 1]], axis=1) / pitch - 0.5 - jy
    i0 = np.clip(np.ceil(xs.min(axis=1)), 0, nx).astype(np.int64)
    i1 = np.clip(np.floor(xs.max(axis=1)), -1, nx - 1).astype(np.int64)
    j0 = np.clip(np.ceil(ys.min(axis=1)), 0, ny).astype(np.int64)
    j1 = np.clip(np.floor(ys.max(axis=1)), -1, ny - 1).astype(np.int64)
    wi = np.maximum(i1 - i0 + 1, 0)
    wj = np.maximum(j1 - j0 + 1, 0)
    counts = wi * wj
    cols, zs = [], []
    start = 0
    # in batches of triangles, so a huge part cannot build one enormous array
    while start < len(counts):
        total, end = 0, start
        while end < len(counts) and (total == 0 or total + counts[end] <= _MAX_PAIRS):
            total += counts[end]
            end += 1
        sel = slice(start, end)
        start = end
        if total == 0:
            continue
        t = np.repeat(np.arange(sel.start, sel.stop), counts[sel])
        offset = np.arange(total) - np.repeat(np.cumsum(counts[sel]) - counts[sel], counts[sel])
        ii = i0[t] + offset // wj[t]
        jj = j0[t] + offset % wj[t]
        px = (ii + 0.5 + jx) * pitch
        py = (jj + 0.5 + jy) * pitch
        ax, ay, bx, by, cx, cy = a[t, 0], a[t, 1], b[t, 0], b[t, 1], c[t, 0], c[t, 1]
        w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area[t]
        w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area[t]
        w2 = 1.0 - w0 - w1
        inside = (w0 >= 0) & (w1 >= 0) & (w2 >= 0)
        z = w0 * a[t, 2] + w1 * b[t, 2] + w2 * c[t, 2]
        cols.append((ii * ny + jj)[inside])
        zs.append(z[inside])
    if not cols:
        return np.zeros(shape, dtype=bool)
    col = np.concatenate(cols)
    z = np.concatenate(zs)
    order = np.lexsort((z, col))
    col, z = col[order], z[order]
    # rank of each crossing within its column; an odd last crossing (an open mesh) is dropped
    first = np.r_[True, col[1:] != col[:-1]]
    starts = np.flatnonzero(first)
    sizes = np.diff(np.r_[starts, len(col)])
    rank = np.arange(len(col)) - np.repeat(starts, sizes)
    usable = rank < np.repeat(sizes - sizes % 2, sizes)
    col, z, rank = col[usable], z[usable], rank[usable]
    enter, leave = z[rank % 2 == 0], z[rank % 2 == 1]
    column = col[rank % 2 == 0]
    k0 = np.clip(np.ceil(enter / pitch - 0.5), 0, nz).astype(np.int64)
    k1 = np.clip(np.ceil(leave / pitch - 0.5), 0, nz).astype(np.int64)
    ci, cj = column // ny, column % ny
    np.add.at(grid, (ci, cj, k0), 1)
    np.add.at(grid, (ci, cj, k1), -1)
    return np.cumsum(grid, axis=2)[:, :, :nz] > 0


def iou(tri_a: np.ndarray, tri_b: np.ndarray, resolution: int = RESOLUTION) -> dict:
    """Voxel IoU of two meshes, each moved so its bounding-box min corner is at the origin."""
    a = np.asarray(tri_a, dtype=np.float64).reshape(-1, 3, 3)
    b = np.asarray(tri_b, dtype=np.float64).reshape(-1, 3, 3)
    if not len(a) or not len(b):
        return {"iou": None, "pitch": None, "shape": None}
    a = a - a.reshape(-1, 3).min(axis=0)
    b = b - b.reshape(-1, 3).min(axis=0)
    extent = np.maximum(a.reshape(-1, 3).max(axis=0), b.reshape(-1, 3).max(axis=0))
    longest = float(extent.max())
    if longest <= 0:
        return {"iou": None, "pitch": None, "shape": None}
    pitch = longest / resolution
    shape = tuple(int(max(1, math.ceil(e / pitch))) for e in extent)
    fa, fb = fill(a, pitch, shape), fill(b, pitch, shape)
    union = int(np.count_nonzero(fa | fb))
    inter = int(np.count_nonzero(fa & fb))
    return {
        "iou": inter / union if union else None,
        "pitch": pitch,
        "shape": list(shape),
        "voxels_a": int(np.count_nonzero(fa)),
        "voxels_b": int(np.count_nonzero(fb)),
    }
