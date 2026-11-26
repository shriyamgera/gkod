"""GKod's MCP server: compile, check and look at 3D-printable parts written as OpenSCAD with named sizes."""

import hashlib
import json
import math
import re
from pathlib import Path
from typing import Any, Literal

from mcp.server.mcpserver import Image, MCPServer

from gkod_mcp.examples import example_source, examples
from gkod_mcp.node import GkodError, run_gkod
from gkod_mcp.paths import out_dir

View = Literal["iso", "front", "side", "top"]
# the printers gkod check knows (tools/src/printers.ts); the Kobra 2 Neo is the owner's
Printer = Literal["kobra2neo", "p1s", "a1", "ender3v2", "mk4"]

# A compile stops itself after 10 s; these limits also cover starting Node and loading the compiler.
COMPILE_SECONDS = 40
CHECK_SECONDS = 30
RENDER_SECONDS = 60
PICTURE_PX = 900
NAME = re.compile(r"^[A-Za-z_]\w*$")

server = MCPServer(
    "gkod",
    instructions=(
        "GKod makes 3D-printable parts as OpenSCAD code with named sizes: top-level numbers with a range, "
        "such as `width = 80; // [50:1:160]`. preview_example shows a built-in part; compile_part, check_part "
        "and render_part work on any code. The checks test that the part is closed, fits the printer bed, sits "
        "flat and has no overhang steeper than 45 degrees that would sag. Pictures show the part on a 10 mm bed "
        "grid with its size in mm; faces that would sag are orange. minkowski() and text() are not supported: "
        "round corners with hull(). The default printer is an Anycubic Kobra 2 Neo (220 x 220 x 250 mm)."
    ),
)


def _defines(sizes: dict[str, float] | None) -> list[str]:
    args = []
    for name, value in (sizes or {}).items():
        number = isinstance(value, int | float) and not isinstance(value, bool) and math.isfinite(value)
        if not NAME.match(name) or not number:
            raise GkodError(f'Sizes take a name and a number, like {{"width": 80}}; "{name}": {value!r} is not one.')
        args += ["-D", f"{name}={value!r}"]
    return args


def _compile(code: str, sizes: dict[str, float] | None, stem: str = "part") -> dict[str, Any]:
    defines = _defines(sizes)
    key = hashlib.sha256(json.dumps([code, sizes or {}], sort_keys=True).encode()).hexdigest()[:12]
    folder = out_dir()
    scad, stl = folder / f"{stem}-{key}.scad", folder / f"{stem}-{key}.stl"
    scad.write_text(code)
    result = run_gkod(["compile", str(scad), "-o", str(stl), *defines], COMPILE_SECONDS)
    return {
        "ok": result["ok"],
        "stl_path": str(stl) if result["ok"] else None,
        "params": result["params"],
        "error": result["error"],
        "log_tail": result["log"][-10:],
        "ms": result["ms"],
        "triangles": result["triangles"],
    }


def _mm(values: list[float]) -> str:
    return " x ".join(f"{round(v, 1):g}" for v in values)


def _check(stl_path: str, printer: str) -> dict[str, Any]:
    path = Path(stl_path).expanduser()
    if not path.is_file():
        raise GkodError(f"There is no STL file at {stl_path}.")
    report = run_gkod(["check", str(path), "--printer", printer], CHECK_SECONDS)
    size = [round(v, 1) for v in report["stats"]["size"]]
    checks = []
    for result in report["results"]:
        kept = {k: v for k, v in result.items() if k != "triangles"}
        if "at" in kept:
            kept["at"] = [round(v, 1) for v in kept["at"]]
        checks.append(kept)
    lines = [
        f"{'Ready to print' if report['ok'] else 'Needs changes'} on the {report['printerName']}: "
        f"{_mm(size)} mm, {report['stats']['triangles']} triangles."
    ]
    for result in checks:
        if result["ok"]:
            lines.append(f"- pass: {result['title']}")
        else:
            fix = f" Fix: {result['fix']}" if result.get("fix") else ""
            lines.append(f"- FAIL: {result['title']}. {result['detail']}{fix}")
    bed = report["bed"]
    return {
        "ready": report["ok"],
        "summary": "\n".join(lines),
        "printer": report["printerName"],
        "bed_mm": [bed["x"], bed["y"], bed["z"]],
        "size_mm": size,
        "triangles": report["stats"]["triangles"],
        "checks": checks,
        "stl_path": str(path),
    }


def _render(stl_path: str, view: str, mark_overhangs: bool) -> Path:
    png = out_dir() / f"{Path(stl_path).stem}-{view}.png"
    args = ["render", stl_path, "-o", str(png), "--view", view, "--size", str(PICTURE_PX)]
    if mark_overhangs:
        args.append("--mark-overhangs")
    run_gkod(args, RENDER_SECONDS)
    return png


def _one_line(report: dict[str, Any], view: str, mark_overhangs: bool) -> str:
    failed = [check for check in report["checks"] if not check["ok"]]
    if failed:
        verdict = "needs changes: " + " ".join(f"{check['title']}: {check['detail']}" for check in failed)
    else:
        verdict = f"ready to print on the {report['printer']}."
    marked = mark_overhangs and any(check["id"] == "overhang" for check in failed)
    return (
        f"{view} view, {_mm(report['size_mm'])} mm, {report['triangles']} triangles, {verdict}"
        f"{' Orange shows where it would sag.' if marked else ''}"
    )


@server.tool()
def list_examples() -> list[dict[str, Any]]:
    """The built-in example parts, each with its named sizes (value, range and caption) and the path of its code."""
    return list(examples().values())


@server.tool()
def compile_part(code: str, sizes: dict[str, float] | None = None) -> dict[str, Any]:
    """Compiles OpenSCAD code to an STL file with the same compiler, flags and 10 second limit as the GKod site.

    sizes overrides named sizes without editing the code, e.g. {"width": 100}. Returns ok, stl_path, the part's
    named sizes (params), a plain error with its line number when it fails, the last log lines and the time in ms.
    """
    return _compile(code, sizes)


@server.tool()
def check_part(stl_path: str, printer: Printer = "kobra2neo") -> dict[str, Any]:
    """Runs GKod's print checks on an STL file: closed, fits the printer, sits flat, no steep overhangs.

    Returns the report in plain words (summary) and as JSON (checks), with a fix for each failed check.
    """
    return _check(stl_path, printer)


@server.tool(structured_output=False)
def render_part(
    code: str | None = None,
    stl_path: str | None = None,
    view: View = "iso",
    mark_overhangs: bool = True,
    sizes: dict[str, float] | None = None,
    printer: Printer = "kobra2neo",
) -> list[Image | str]:
    """Draws a part as a PNG picture to look at, from OpenSCAD code (compiled first, with optional sizes) or an STL file.

    The part sits on a 10 mm bed grid with its size in mm in the corner. With mark_overhangs, faces that would sag
    are orange (seen through the part when they are underneath). Also returns a one-line summary: size, triangles,
    and ready to print or what to fix.
    """
    if (code is None) == (stl_path is None):
        raise GkodError("Give either code or stl_path, not both or neither.")
    if code is not None:
        compiled = _compile(code, sizes)
        if not compiled["ok"]:
            raise GkodError(f"The code did not compile: {compiled['error']}")
        stl_path = compiled["stl_path"]
    elif sizes:
        raise GkodError("sizes only work with code; an STL file has its sizes fixed.")
    report = _check(stl_path, printer)
    png = _render(report["stl_path"], view, mark_overhangs)
    text = f"{_one_line(report, view, mark_overhangs)}\nSTL: {report['stl_path']}\nPicture: {png}"
    return [Image(data=png.read_bytes(), format="png"), text]


@server.tool(structured_output=False)
def preview_example(name: str, view: View = "iso", printer: Printer = "kobra2neo") -> list[Image | str]:
    """Compiles, checks and draws one of the built-in examples (see list_examples) in one call.

    Returns the picture, the named sizes, the check report in plain words, the file paths and the code.
    """
    try:
        source = example_source(name)
    except KeyError:
        raise GkodError(f"There is no example called {name!r}. Examples: {', '.join(examples())}.") from None
    compiled = _compile(source, None, stem=name)
    if not compiled["ok"]:
        raise GkodError(f"The example did not compile: {compiled['error']}")
    report = _check(compiled["stl_path"], printer)
    png = _render(compiled["stl_path"], view, mark_overhangs=True)
    info = examples()[name]
    sizes = "\n".join(
        f"- {p['name']} = {p['value']:g} ({p.get('caption', 'no caption')}; {p['min']:g} to {p['max']:g})"
        for p in compiled["params"]
    )
    text = (
        f"{info['title']}: {info['about']}\n"
        f"Compiled in {compiled['ms']} ms.\n\nNamed sizes:\n{sizes}\n\n{report['summary']}\n\n"
        f"STL: {compiled['stl_path']}\nPicture: {png}\n\nCode ({info['path']}):\n{source}"
    )
    return [Image(data=png.read_bytes(), format="png"), text]
