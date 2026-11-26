from pathlib import Path

import pytest

from gkod_mcp import server
from gkod_mcp.examples import example_source, read_sizes
from gkod_mcp.node import GkodError, find_node, run_gkod
from gkod_mcp.paths import REPO

PNG = b"\x89PNG\r\n\x1a\n"
T_SHAPE = """
post = 12; // [6:1:30]
bar = 70; // [30:1:120]
translate([-post / 2, -post / 2, 0]) cube([post, post, 40]);
translate([-bar / 2, -post / 2, 40]) cube([bar, post, 8]);
"""


def stl_triangles(path: str) -> int:
    data = Path(path).read_bytes()
    count = int.from_bytes(data[80:84], "little")
    assert len(data) == 84 + 50 * count
    return count


def test_node_is_found_and_new_enough():
    assert Path(find_node()).is_absolute()


def test_list_examples_gives_every_built_in_part_with_the_sizes_the_compiler_reports():
    listed = server.list_examples()
    on_disk = sorted(p.stem for p in (REPO / "app" / "src" / "examples").glob("*.scad"))
    assert [e["name"] for e in listed] == on_disk
    assert {"cable_clip", "phone_stand", "wall_hook", "test_cube"} <= set(on_disk)
    assert all(e["title"] for e in listed)
    for example in listed:
        assert Path(example["path"]).is_file()
        compiled = server.compile_part(example_source(example["name"]))
        assert compiled["ok"], compiled["error"]
        from_compiler = [{k: p[k] for k in ("name", "value", "min", "max", "step")} for p in compiled["params"]]
        from_listing = [{k: s[k] for k in ("name", "value", "min", "max", "step")} for s in example["sizes"]]
        assert from_listing == from_compiler
        assert all(s["caption"] for s in example["sizes"])


def test_read_sizes_takes_ranges_options_and_stops_at_hidden():
    sizes = read_sizes("// Width (mm)\nw = 10; // [5:20]\nscrew = 3; // [3, 4, 5]\n/* [Hidden] */\nh = 2; // [1:3]\n")
    assert sizes == [
        {"name": "w", "value": 10, "min": 5, "max": 20, "step": 1, "caption": "Width (mm)"},
        {"name": "screw", "value": 3, "options": [3, 4, 5]},
    ]


def test_compile_part_writes_an_stl_named_by_the_code_and_sizes(out_folder):
    first = server.compile_part("cube([20, 10, 5]);")
    assert first["ok"] and first["error"] is None
    assert Path(first["stl_path"]).parent == out_folder.resolve()
    assert stl_triangles(first["stl_path"]) == first["triangles"] == 12
    assert isinstance(first["ms"], int) and first["log_tail"]
    assert server.compile_part("cube([20, 10, 5]);")["stl_path"] == first["stl_path"]
    assert server.compile_part("cube([20, 10, 5]);", {"x": 1})["stl_path"] != first["stl_path"]


def test_compile_part_applies_sizes_without_editing_the_code():
    result = server.compile_part(example_source("phone_stand"), {"width": 100, "angle": 62.5})
    assert result["ok"], result["error"]
    values = {p["name"]: p["value"] for p in result["params"]}
    assert values["width"] == 100 and values["angle"] == 62.5
    assert server.check_part(result["stl_path"])["size_mm"][0] == 100


def test_compile_part_reports_errors_in_plain_words():
    broken = server.compile_part("cube(10")
    assert broken["ok"] is False and broken["stl_path"] is None
    assert broken["error"].startswith("Line ")
    unknown = server.compile_part("cube([w, 10, 10]);")
    assert unknown["ok"] is False and "Unknown variable" in unknown["error"]
    slow = server.compile_part("minkowski() { cube(5); sphere(1); }")
    assert slow["ok"] is False and "hull()" in slow["error"]


def test_compile_part_refuses_sizes_that_are_not_numbers():
    for sizes in [{"width": "wide"}, {"2w": 3}, {"w": True}, {"w": float("nan")}, {"w": 10**400}]:
        with pytest.raises(GkodError, match="Sizes take a name and a number"):
            server.compile_part("cube(1);", sizes)


def test_check_part_gives_plain_words_and_json():
    stl = server.compile_part(example_source("wall_hook"))["stl_path"]
    report = server.check_part(stl)
    assert report["ready"] is True
    assert report["printer"] == "Anycubic Kobra 2 Neo" and report["bed_mm"] == [220, 220, 250]
    assert report["summary"].startswith("Ready to print on the Anycubic Kobra 2 Neo: 35 x 80 x 20 mm")
    assert [c["id"] for c in report["checks"]] == ["closed", "fits-bed", "flat-base", "overhang"]
    assert server.check_part(stl, "mk4")["bed_mm"] == [250, 210, 220]


def test_check_part_names_what_to_fix():
    stl = server.compile_part(T_SHAPE)["stl_path"]
    report = server.check_part(stl)
    assert report["ready"] is False
    overhang = report["checks"][3]
    assert overhang["ok"] is False and "triangles" not in overhang and len(overhang["at"]) == 3
    assert "- FAIL: No steep overhangs." in report["summary"] and "Fix: " in report["summary"]
    too_big = server.compile_part("cube([240, 20, 20]);")["stl_path"]
    assert server.check_part(too_big)["ready"] is False
    assert server.check_part(too_big, "p1s")["ready"] is True


def test_check_part_needs_a_real_file(out_folder):
    with pytest.raises(GkodError, match="There is no STL file at "):
        server.check_part(str(out_folder / "no_such.stl"))


def test_check_part_reads_only_stl_files_in_the_repo_or_the_output_folder(tmp_path):
    for path in ["/no/such.stl", str(tmp_path / "part.stl"), "README.md", str(REPO / "checks" / "README.md")]:
        with pytest.raises(GkodError, match="Give an STL file inside the GKod repo or its output folder"):
            server.check_part(path)
    assert server.check_part("checks/test/fixtures/cable_clip.stl")["ready"] is True


def test_the_printers_offered_are_the_ones_gkod_knows():
    offered = list(server.PRINTERS)
    stl = REPO / "checks" / "test" / "fixtures" / "cable_clip.stl"
    with pytest.raises(GkodError) as raised:
        run_gkod(["check", str(stl), "--printer", "nope"], 30)
    assert f"Known printers: {', '.join(offered)}." in str(raised.value)


def test_render_part_returns_a_picture_and_one_line(out_folder):
    picture, text = server.render_part(code=T_SHAPE)
    assert picture.data.startswith(PNG) and picture._mime_type == "image/png"
    first_line = text.splitlines()[0]
    assert first_line.startswith("iso view, 70 x 12 x 48 mm, 28 triangles, needs changes: No steep overhangs")
    assert "Orange shows where it would sag." in first_line
    png = Path(text.splitlines()[2].removeprefix("Picture: "))
    assert png.parent == out_folder.resolve() and png.read_bytes() == picture.data


def test_render_part_draws_an_stl_from_any_side():
    stl = server.compile_part(example_source("cable_clip"))["stl_path"]
    for view in ["front", "side", "top"]:
        picture, text = server.render_part(stl_path=stl, view=view, mark_overhangs=False)
        assert picture.data.startswith(PNG)
        assert text.startswith(f"{view} view, 20 x 9.9 x 12 mm, 400 triangles, ready to print on the Anycubic Kobra 2 Neo.")


def test_render_part_says_when_the_grid_is_coarser():
    _, small = server.render_part(code="cube(10);")
    assert "grid" not in small
    _, huge = server.render_part(code="cube([w, w, w]);", sizes={"w": 1e6})
    assert "1e+06 x 1e+06 x 1e+06 mm" in huge and "The grid lines are 10000 mm apart." in huge


def test_render_part_explains_wrong_calls():
    with pytest.raises(GkodError, match="either code or stl_path"):
        server.render_part()
    with pytest.raises(GkodError, match="either code or stl_path"):
        server.render_part(code="cube(1);", stl_path="/x.stl")
    with pytest.raises(GkodError, match="sizes only work with code"):
        server.render_part(stl_path="/x.stl", sizes={"w": 1})
    with pytest.raises(GkodError, match="The code did not compile: Line "):
        server.render_part(code="cube(10")


def test_render_part_refuses_files_that_are_not_stl(out_folder):
    stl = Path(server.compile_part("cube(10);")["stl_path"])
    named = stl.with_suffix(".scad")
    named.write_bytes(stl.read_bytes())
    with pytest.raises(GkodError, match="Give an STL file inside the GKod repo"):
        server.render_part(stl_path=str(named))


def test_a_failed_render_says_why(tmp_path):
    broken = tmp_path / "broken.scad"
    broken.write_text("cube(10")
    with pytest.raises(GkodError, match=r"The picture could not be drawn: Line \d+: Parser error"):
        server._render(str(broken), "iso", False)


def test_preview_example_does_everything_in_one_call():
    picture, text = server.preview_example("phone_stand", view="side")
    assert picture.data.startswith(PNG)
    assert text.startswith("Phone stand: Base, tilted back plate")
    assert "- width = 80 (Stand width (mm); 50 to 160)" in text
    assert "Ready to print on the Anycubic Kobra 2 Neo" in text
    assert text.rstrip().endswith(example_source("phone_stand").rstrip())


def test_preview_example_lists_the_examples_for_an_unknown_name():
    with pytest.raises(GkodError, match="Examples: cable_clip, phone_stand, test_cube, wall_hook"):
        server.preview_example("bracket")


@pytest.mark.anyio
async def test_the_schema_offers_the_printers_views_and_number_sizes():
    tools = {tool.name: tool.input_schema["properties"] for tool in await server.server.list_tools()}
    assert tools["check_part"]["printer"]["enum"] == list(server.PRINTERS)
    assert tools["render_part"]["view"]["enum"] == list(server.VIEWS)
    assert tools["render_part"]["view"]["default"] == "iso"
    assert tools["compile_part"]["sizes"]["anyOf"][0]["additionalProperties"] == {"type": "number"}


@pytest.mark.anyio
async def test_the_server_turns_pictures_into_image_content():
    result = await server.server.call_tool("render_part", {"code": "cube(10);"})
    assert [block.type for block in result.content] == ["image", "text"]
    assert result.content[0].mime_type == "image/png"
    assert not result.is_error
