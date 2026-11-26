import base64
import sys

import pytest
from mcp import Client, StdioServerParameters

from gkod_mcp.paths import REPO

TOOLS = {"list_examples", "compile_part", "check_part", "render_part", "preview_example"}


@pytest.mark.anyio
async def test_a_client_starts_the_server_lists_the_tools_and_previews_an_example(out_folder):
    params = StdioServerParameters(
        command=sys.executable,
        args=["-m", "gkod_mcp"],
        cwd=str(REPO),
        env={"GKOD_OUT": str(out_folder)},
    )
    async with Client(params, read_timeout_seconds=120) as client:
        listed = await client.list_tools()
        assert {tool.name for tool in listed.tools} == TOOLS
        result = await client.call_tool("preview_example", {"name": "phone_stand"})
    assert not result.is_error
    image, text = result.content
    assert image.type == "image" and image.mime_type == "image/png"
    assert base64.b64decode(image.data).startswith(b"\x89PNG\r\n\x1a\n")
    assert text.type == "text" and "Ready to print on the Anycubic Kobra 2 Neo" in text.text
    assert list(out_folder.glob("phone_stand-*-iso.png"))
