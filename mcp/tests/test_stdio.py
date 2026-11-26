import base64
import shutil
import sys

import pytest
from mcp import Client, StdioServerParameters

from gkod_mcp.paths import REPO

TOOLS = {"list_examples", "compile_part", "check_part", "render_part", "preview_example"}
FIXTURE = REPO / "checks" / "test" / "fixtures" / "cable_clip.stl"


def start(out_folder, cwd=REPO) -> Client:
    params = StdioServerParameters(
        command=sys.executable,
        args=["-m", "gkod_mcp"],
        cwd=str(cwd),
        env={"GKOD_OUT": str(out_folder)},
    )
    return Client(params, read_timeout_seconds=120)


@pytest.mark.anyio
async def test_a_client_starts_the_server_lists_the_tools_and_previews_an_example(out_folder):
    async with start(out_folder) as client:
        listed = await client.list_tools()
        assert {tool.name for tool in listed.tools} == TOOLS
        result = await client.call_tool("preview_example", {"name": "phone_stand"})
    assert not result.is_error
    image, text = result.content
    assert image.type == "image" and image.mime_type == "image/png"
    assert base64.b64decode(image.data).startswith(b"\x89PNG\r\n\x1a\n")
    assert text.type == "text" and "Ready to print on the Anycubic Kobra 2 Neo" in text.text
    assert list(out_folder.glob("phone_stand-*-iso.png"))


@pytest.mark.anyio
async def test_the_server_reads_only_stl_files_in_the_repo_or_its_output_folder(out_folder, tmp_path):
    outside = tmp_path / "outside.stl"
    shutil.copy(FIXTURE, outside)
    out_folder.mkdir(parents=True, exist_ok=True)
    link = out_folder / "link.stl"
    link.symlink_to(outside)
    calls = [
        ("check_part", {"stl_path": "/etc/passwd"}),
        ("check_part", {"stl_path": "../../../../../../../../etc/hosts"}),
        ("check_part", {"stl_path": str(REPO / "checks/test/fixtures/../../../README.md")}),
        ("check_part", {"stl_path": str(outside)}),
        ("check_part", {"stl_path": str(link)}),
        ("render_part", {"stl_path": str(outside)}),
        ("render_part", {"stl_path": str(link)}),
    ]
    async with start(out_folder) as client:
        for name, args in calls:
            result = await client.call_tool(name, args)
            text = result.content[0].text
            assert result.is_error and "Give an STL file inside the GKod repo or its output folder" in text, (args, text)
            assert "triangles" not in text and "bytes" not in text
        inside = await client.call_tool("check_part", {"stl_path": str(FIXTURE)})
    assert not inside.is_error


@pytest.mark.anyio
async def test_relative_stl_paths_start_at_the_repo_when_the_server_runs_elsewhere(out_folder, tmp_path):
    shutil.copy(FIXTURE, tmp_path / "here.stl")
    async with start(out_folder, cwd=tmp_path) as client:
        checked = await client.call_tool("check_part", {"stl_path": "checks/test/fixtures/cable_clip.stl"})
        drawn = await client.call_tool("render_part", {"stl_path": "checks/test/fixtures/cable_clip.stl"})
        here = await client.call_tool("check_part", {"stl_path": "here.stl"})
    assert not checked.is_error and checked.structured_content["stl_path"] == str(FIXTURE)
    assert not drawn.is_error and [block.type for block in drawn.content] == ["image", "text"]
    assert here.is_error and "There is no STL file at here.stl" in here.content[0].text


@pytest.mark.anyio
async def test_wrong_printers_views_and_sizes_get_plain_messages(out_folder):
    printers = "There is no printer called 'nope'. Printers: kobra2neo, p1s, a1, ender3v2, mk4."
    calls = [
        ("check_part", {"stl_path": str(FIXTURE), "printer": "nope"}, printers),
        ("render_part", {"code": "cube(10);", "printer": "nope"}, printers),
        ("render_part", {"code": "cube(10);", "view": "bottom"}, "There is no view called 'bottom'. Views: iso, front, side, top."),
        ("preview_example", {"name": "phone_stand", "printer": "nope"}, printers),
        ("compile_part", {"code": "cube(1);", "sizes": {"w": "wide"}}, """Sizes take a name and a number, like {"width": 80}; "w": 'wide' is not one."""),
        ("render_part", {"code": "cube(1);", "sizes": {"w": 10**400}}, "Sizes take a name and a number"),
    ]
    async with start(out_folder) as client:
        for name, args, message in calls:
            result = await client.call_tool(name, args)
            text = result.content[0].text
            assert result.is_error and message in text, (args, text)
            assert "pydantic" not in text
