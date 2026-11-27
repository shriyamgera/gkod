import json
from pathlib import Path

import pytest

from gkod_bench.extract import extract_code, find_banned_call

CASES = json.loads((Path(__file__).parent / "fixtures" / "extract_cases.json").read_text())["cases"]


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_same_result_as_the_site(case):
    # the expected results are the site's own (tools/test/bench-fixtures.test.ts checks them with extract.ts)
    assert extract_code(case["answer"]) == case["expected"]


def test_the_cases_cover_every_outcome():
    problems = {c["expected"].get("problem") for c in CASES}
    assert problems == {None, "no-code", "too-long", "blocked"}


def test_banned_calls():
    assert "hull()" in find_banned_call("minkowski() { cube(10); sphere(2); }")
    assert find_banned_call("union() {\n  minkowski\n  () { cube(1); }\n}")
    assert find_banned_call("module context(a) { cube(a); } context(2);") is None
    assert find_banned_call("text_size = 4; cube(text_size);") is None
    assert find_banned_call('echo("// not a comment"); minkowski() { cube(1); }')
    assert find_banned_call("cube(1); /* note */ text(\"a\");")
