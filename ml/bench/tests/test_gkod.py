import pytest

from gkod_bench.gkod import TIMEOUT_MESSAGE, Gkod, GkodError
from gkod_bench.paths import REPO

needs_compiler = pytest.mark.skipif(
    not (REPO / "app" / "public" / "openscad" / "openscad.wasm").exists(),
    reason="the OpenSCAD web build is missing (npm run fetch:openscad)",
)

SITE_PROMPTS = (REPO / "app" / "src" / "engine" / "prompts.ts").read_text()


def test_prompts_come_from_the_site():
    with Gkod(workers=1) as g:
        create = g.prompt({"kind": "create", "prompt": "A box, 20 mm wide "}, answer="cube(20);\n")
        edit = g.prompt({"kind": "edit", "instruction": "make it 5 mm taller", "code": "cube(20);\n"})
    assert create["user"] == "Make this part: A box, 20 mm wide"
    assert create["answer"] == "```openscad\ncube(20);\n```"
    # the system prompt is the site's text, word for word
    assert create["system"].startswith("You write OpenSCAD code for parts")
    assert all(line in SITE_PROMPTS for line in create["system"].splitlines())
    assert edit["user"].startswith("Here is the current OpenSCAD code for the part:\n\n```openscad\ncube(20);\n```")
    assert "Change it like this: make it 5 mm taller" in edit["user"]


def test_bad_prompt_request():
    with Gkod(workers=1) as g, pytest.raises(GkodError):
        g.prompt({"kind": "repair"})


@needs_compiler
def test_replies_come_back_in_job_order():
    with Gkod(workers=3) as g:
        replies = g.compile_many([{"code": f"cube({n});", "check": False} for n in range(1, 7)])
    assert [r["ok"] for r in replies] == [True] * 6
    assert len({r["stl_sha256"] for r in replies}) == 6


def test_a_timeout_under_load_is_compiled_again_alone():
    g = Gkod.__new__(Gkod)
    calls = []

    def fake_run(jobs):
        calls.append(len(jobs))
        if len(jobs) > 1:
            return [{"ok": True}, {"ok": False, "error": TIMEOUT_MESSAGE, "ms": 10000}]
        return [{"ok": True, "ms": 120}]

    g.run = fake_run
    replies = g.compile_many([{"code": "a"}, {"code": "b"}])
    assert calls == [2, 1]
    assert replies[1]["ok"] and replies[1]["first_try"] == {"error": TIMEOUT_MESSAGE, "ms": 10000}
