"""The site's built-in example parts (app/src/examples/*.scad) and their named sizes."""

import re
from typing import Any

from gkod_mcp.paths import EXAMPLES

# "width = 80; // [50:1:160]": a top-level number with a slider range, as the site's size panel reads it
SIZE = re.compile(r"^([a-z_]\w*)\s*=\s*(-?[\d.]+)\s*;\s*//\s*\[([^\]]+)\]", re.IGNORECASE)


def _number(text: str) -> float | int:
    value = float(text)
    return int(value) if value.is_integer() else value


def _range(text: str) -> dict[str, Any]:
    if ":" in text:
        parts = [_number(part) for part in text.split(":")]
        low, step, high = (parts[0], 1, parts[1]) if len(parts) == 2 else parts[:3]
        return {"min": low, "max": high, "step": step}
    return {"options": [_number(part) for part in text.split(",")]}


def read_sizes(source: str) -> list[dict[str, Any]]:
    """The named sizes in OpenSCAD source, with the comment line above each as its caption."""
    sizes = []
    lines = source.splitlines()
    for i, line in enumerate(lines):
        if line.strip().startswith("/* [Hidden]"):
            break
        match = SIZE.match(line.strip())
        if not match:
            continue
        size: dict[str, Any] = {"name": match[1], "value": _number(match[2]), **_range(match[3])}
        above = lines[i - 1].strip() if i > 0 else ""
        if above.startswith("//"):
            size["caption"] = above.lstrip("/ ").strip()
        sizes.append(size)
    return sizes


def examples() -> dict[str, dict[str, Any]]:
    found = {}
    for path in sorted(EXAMPLES.glob("*.scad")):
        source = path.read_text()
        title = path.stem.replace("_", " ").capitalize()
        # the first comment line says what the part is, sometimes after "Title:"
        about = source.splitlines()[0].lstrip("/ ").strip() if source else ""
        if about.lower().startswith(f"{title.lower()}:"):
            about = about[len(title) + 1 :].strip()
        found[path.stem] = {
            "name": path.stem,
            "title": title,
            "about": about[:1].upper() + about[1:],
            "sizes": read_sizes(source),
            "path": str(path),
        }
    return found


def example_source(name: str) -> str:
    known = examples()
    if name not in known:
        raise KeyError(name)
    return (EXAMPLES / f"{name}.scad").read_text()
