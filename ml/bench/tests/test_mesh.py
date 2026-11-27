import math

import numpy as np
import pytest
from shapes import box, hollow_cube, plate_with_holes, ring

from gkod_bench.mesh import measure
from gkod_bench.stl import StlError, parse_stl, read_stl, stl_bytes, write_stl


def test_stl_round_trip(tmp_path):
    tri = box(10, 20, 5)
    path = tmp_path / "box.stl"
    write_stl(path, tri)
    assert path.stat().st_size == 84 + 50 * 12
    back = read_stl(path)
    assert back.shape == (12, 3, 3)
    assert np.allclose(back, tri)


def test_ascii_stl_and_bad_bytes():
    text = b"solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid t\n"
    assert parse_stl(text).shape == (1, 3, 3)
    with pytest.raises(StlError):
        parse_stl(b"not an stl at all")
    with pytest.raises(StlError):
        parse_stl(stl_bytes(box(1, 1, 1))[:-10])


def test_box_measures():
    info = measure(box(10, 20, 5, offset=(-5, 1, 0)))
    assert info.triangles == 12
    assert info.min == (-5.0, 1.0, 0.0)
    assert info.size == (10.0, 20.0, 5.0)
    assert math.isclose(info.volume, 1000.0)
    assert info.closed and info.shells == 1 and info.genus == 0


@pytest.mark.parametrize("holes", [1, 2, 4])
def test_genus_counts_through_holes(holes):
    info = measure(plate_with_holes(holes))
    assert info.closed and info.shells == 1
    assert info.genus == holes


def test_ring_has_one_hole():
    assert measure(ring()).genus == 1


def test_two_pieces_have_no_genus():
    two = np.concatenate([box(1, 1, 1), box(1, 1, 1, offset=(5, 0, 0))])
    info = measure(two)
    assert info.closed and info.shells == 2 and info.genus is None


def test_hollow_body_is_two_surfaces():
    info = measure(hollow_cube())
    assert info.closed and info.shells == 2 and info.genus is None
    assert math.isclose(info.volume, 26.0)


def test_open_and_flipped_meshes_are_not_closed():
    tri = box(2, 2, 2)
    assert not measure(tri[:-1]).closed
    flipped = tri.copy()
    flipped[0] = flipped[0][[0, 2, 1]]
    info = measure(flipped)
    assert not info.closed and info.genus is None
    assert measure(np.zeros((0, 3, 3))).triangles == 0


def test_corners_closer_than_the_join_tolerance_are_one_corner():
    tri = box(10, 10, 10)
    nudged = tri + np.random.default_rng(1).uniform(-2e-5, 2e-5, tri.shape)
    info = measure(nudged)
    assert info.closed and info.genus == 0
