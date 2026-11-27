"""Hand-made meshes for the scorer tests: blocks built from unit cubes, with every face pointing outwards."""

import numpy as np

# for each direction: the axis, the side, and the two other axes in an order that makes the face point outwards
_FACES = [(0, 1, 1, 2), (0, 0, 2, 1), (1, 1, 2, 0), (1, 0, 0, 2), (2, 1, 0, 1), (2, 0, 1, 0)]


def blocks(cells, scale=(1.0, 1.0, 1.0), offset=(0.0, 0.0, 0.0)) -> np.ndarray:
    """The outer surface of a set of unit cubes given as (x, y, z) cells. Two cubes that touch only along an edge
    make a surface that is not closed, so the tests avoid that."""
    filled = {tuple(c) for c in cells}
    tris = []
    for cell in filled:
        for axis, side, u, v in _FACES:
            step = [0, 0, 0]
            step[axis] = 1 if side else -1
            if (cell[0] + step[0], cell[1] + step[1], cell[2] + step[2]) in filled:
                continue
            base = list(cell)
            base[axis] += side
            corners = []
            for du, dv in ((0, 0), (1, 0), (1, 1), (0, 1)):
                p = list(base)
                p[u] += du
                p[v] += dv
                corners.append(p)
            p0, p1, p2, p3 = (np.array(p, dtype=float) for p in corners)
            normal = np.cross(p1 - p0, p2 - p0)
            if normal[axis] * (1 if side else -1) < 0:
                p1, p3 = p3, p1
            tris += [[p0, p1, p2], [p0, p2, p3]]
    out = np.array(tris, dtype=float)
    return out * np.array(scale) + np.array(offset)


def box(x, y, z, offset=(0.0, 0.0, 0.0)) -> np.ndarray:
    return blocks([(0, 0, 0)], scale=(x, y, z), offset=offset)


def ring() -> np.ndarray:
    """A 3 x 3 x 1 block with the middle cell taken out: one through hole."""
    return blocks([(x, y, 0) for x in range(3) for y in range(3) if (x, y) != (1, 1)])


def plate_with_holes(holes: int) -> np.ndarray:
    """A strip 1 cell deep with `holes` square holes through it, each with a wall on both sides."""
    width = 2 * holes + 1
    cells = [(x, y, 0) for x in range(width) for y in range(3)]
    gone = {(2 * i + 1, 1, 0) for i in range(holes)}
    return blocks([c for c in cells if c not in gone])


def hollow_cube() -> np.ndarray:
    """A 3 x 3 x 3 block with a closed empty cell in the middle: one body, two surfaces."""
    return blocks([(x, y, z) for x in range(3) for y in range(3) for z in range(3) if (x, y, z) != (1, 1, 1)])
