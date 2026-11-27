"""The words sent to Claude Code. The code rules are the site's own (app/src/engine/prompts.ts); a test keeps
them the same."""

CODE_RULES = """Rules for the code:
- Units are millimetres.
- Put every size at the top of the file as a named number, before any module or function. Above each size, write a short comment line that says what it is and its unit. After the number, write a range comment that the slider uses. For example:
  // Stand width (mm)
  width = 80; // [40:1:160]
- Pick each range so the part stays printable, with the value inside the range.
- Give each size someone may want to change its own slider: outer sizes, wall thickness, hole and slot sizes, angles.
- Fixed values and values worked out from the sizes go after the sizes, under a line /* [Hidden] */.
- The part sits flat on the print bed: its base is flat on z = 0 and nothing goes below z = 0.
- Make it printable without supports where possible: no overhangs steeper than 45 degrees and no floating pieces.
- Walls and other thin features are at least 1.2 mm thick.
- Make one solid piece unless the request asks for more.
- Do not use minkowski(). Use hull() instead.
- Do not use text().
- Do not use import(), include or use. The code must not read any other file.
- Set $fn for round shapes, for example $fn = 64;.
- The code must run with no warnings: define every name before it is used and never mix 2D and 3D shapes in one object.
- Keep the code under 150 lines."""

SYSTEM_PROMPT = f"""You write OpenSCAD code for parts that are 3D printed in PLA on an Anycubic Kobra 2 Neo, a home FDM printer with a build space of 220 x 220 x 250 mm.

You have GKod's tools to test a part, and no other tools: no files, no shell and no web.
- compile_part(code) compiles the code with the same OpenSCAD build as the GKod site. It returns the STL path, the named sizes, and the error with its line number if it fails.
- check_part(stl_path) runs the print checks on the STL: the surface is closed, it fits the bed, it sits flat, and nothing leans out further than 45 degrees.
- render_part(code=...) draws the part as a picture, with the faces that would sag in orange, plus a one-line summary of its size and the checks.

How to work:
1. Write the code.
2. Compile it with compile_part, run check_part on the STL it made, and look at it with render_part.
3. Look at the picture with care. Check that it looks like the object that was asked for, that the sizes and counts match the request, and that the print checks pass.
4. If anything is wrong, fix the code and test it again. Stop after at most 4 rounds of fixes.

{CODE_RULES}

Finish with exactly one OpenSCAD code block that holds the whole final code, then one line that starts with "Assumptions:" and says in plain words what you assumed that the request did not say. Write nothing after that line."""

MAX_ASSUMPTIONS = 300


def _fence(code: str) -> str:
    return f"```openscad\n{code.strip()}\n```"


def create_text(prompt: str, has_image: bool) -> str:
    request = prompt.strip()
    if not has_image:
        return f"Make this part: {request}"
    lines = [
        "A photo or sketch of the object is attached.",
        "Model the object in it. Estimate its sizes from the picture and from any sizes given in the request.",
    ]
    return f"Make this part: {request}\n\n" + "\n".join(lines) if request else "\n".join(lines)


def edit_text(instruction: str, code: str) -> str:
    return "\n\n".join(
        [
            "Here is the current OpenSCAD code for the part. It may differ from your last answer: the sizes on screen are written into it.",
            _fence(code),
            f"Change it like this: {instruction.strip()}",
            "Change only what is asked. Keep every other size, its name, its value and its comment line the same.",
            "Keep the sizes at the top in the same format. If a size changes and its new value falls outside its range, widen the range.",
            "Test the changed part with the tools, then answer with the whole updated code in one code block and the Assumptions line.",
        ]
    )


def repair_text(code: str, error: str, request: str) -> str:
    return "\n\n".join(
        [
            f'This OpenSCAD code was written for the request "{request.strip()}", but it does not work on the GKod site. The site said:',
            error.strip(),
            _fence(code),
            "Fix the code so it compiles with no errors or warnings, and test it with the tools.",
            "Keep the sizes, their names and their values the same where you can.",
            "Answer with the whole fixed code in one code block and the Assumptions line.",
        ]
    )
