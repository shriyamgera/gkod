import time

import numpy as np
import pytest
from shapes import blocks, box, hollow_cube, plate_with_holes, ring

from gkod_bench.voxel import TURNS, best_turn_iou, iou


def test_iou_same_shape_moved_is_one():
    r = iou(box(10, 10, 10), box(10, 10, 10, offset=(30, -4, 7)))
    assert r["iou"] == pytest.approx(1.0)


def test_iou_half_box():
    r = iou(box(10, 10, 10), box(10, 10, 5))
    assert r["iou"] == pytest.approx(0.5, abs=0.01)
    assert r["pitch"] == pytest.approx(10 / 200)


def test_iou_ring_against_full_block():
    # the ring is 8 of the 9 cells
    r = iou(blocks([(x, y, 0) for x in range(3) for y in range(3)]), ring())
    assert r["iou"] == pytest.approx(8 / 9, abs=0.01)


def test_iou_disjoint_sizes_and_empty():
    r = iou(box(10, 10, 10), box(20, 20, 20))
    assert r["iou"] == pytest.approx(1 / 8, abs=0.01)
    assert iou(np.zeros((0, 3, 3)), box(1, 1, 1))["iou"] is None


def test_iou_hollow_body_counts_only_the_material():
    r = iou(blocks([(x, y, z) for x in range(3) for y in range(3) for z in range(3)]), hollow_cube())
    assert r["iou"] == pytest.approx(26 / 27, abs=0.01)


def test_iou_is_fast_on_a_detailed_part():
    # a plate with 40 holes: about 1,000 triangles, as many as a busy generated part
    tri = plate_with_holes(40) * np.array([2.0, 2.0, 3.0])
    started = time.perf_counter()
    r = iou(tri, tri)
    assert time.perf_counter() - started < 1.0
    assert r["iou"] == pytest.approx(1.0)


def test_the_24_turns():
    assert len(TURNS) == 24 and np.array_equal(TURNS[0], np.eye(3))
    assert len({m.tobytes() for m in TURNS}) == 24 and all(round(float(np.linalg.det(m))) == 1 for m in TURNS)


def test_best_turn_finds_a_part_drawn_lying_another_way():
    # an L of four cells, which no turn but the right one lines up with itself
    shape = blocks([(0, 0, 0), (1, 0, 0), (2, 0, 0), (0, 1, 0)], scale=(4.0, 3.0, 1.0))
    turn = np.array([[0.0, 0.0, 1.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]])
    turned = (shape.reshape(-1, 3) @ turn.T).reshape(-1, 3, 3)
    r = best_turn_iou(turned, shape)
    assert r["iou"] == pytest.approx(1.0) and r["iou_as_drawn"] < 0.2
    assert r["turn"] == ["+y", "+z", "+x"]
    # as drawn it is the plain iou, number for number
    for a, b in ((box(10, 10, 10), box(10, 10, 5)), (plate_with_holes(3), plate_with_holes(2)), (hollow_cube(), box(3, 3, 3))):
        assert best_turn_iou(a, b)["iou_as_drawn"] == iou(a, b)["iou"]
    assert best_turn_iou(np.zeros((0, 3, 3)), box(1, 1, 1))["iou"] is None


def test_a_flat_face_on_a_row_of_voxel_centres_does_not_flip_its_layer():
    # 48 x 30 x 3: the voxel size is 0.24 mm and the top face, at 12.5 voxels, would sit exactly on a row of centres
    # without the z offset. Drawn with other triangles, or moved, the face's height comes out one bit off 3.0, and the
    # whole top layer flipped (0.989 for the same part).
    plain = box(48, 30, 3)
    finer = blocks([(i, j, 0) for i in range(7) for j in range(7)], scale=(48 / 7, 30 / 7, 3.0))
    assert iou(plain, finer)["iou"] == pytest.approx(1.0, abs=1e-3)
    for offset in ((1.234, 5.678, 0.0), (100.01, -50.3, 0.0), (13.37, -7.1, 0.0)):
        assert iou(plain, box(48, 30, 3, offset=offset))["iou"] == pytest.approx(1.0, abs=1e-3)
        assert best_turn_iou(finer + np.array(offset), plain)["iou"] == pytest.approx(1.0, abs=1e-3)
