import pytest
from fake_set import ScriptedEngine, echo_reference, make_set

from gkod_bench import cli
from gkod_bench.compare import compare_rows, table
from gkod_bench.data import SplitClosed
from gkod_bench.paths import REPO
from gkod_bench.run import run_row

pytestmark = pytest.mark.skipif(
    not (REPO / "app" / "public" / "openscad" / "openscad.wasm").exists(),
    reason="the OpenSCAD web build is missing (npm run fetch:openscad)",
)


@pytest.fixture
def fake(tmp_path):
    sets = tmp_path / "sets"
    hashes = make_set(sets)
    return {"sets_dir": sets, "hashes": hashes, "results": tmp_path / "results", "log": lambda line: None}


def test_wrong_answers_score_lower_and_compare_pairs_them(fake):
    run_row(ScriptedEngine(echo_reference), "good", "dev", **fake)
    bad = ScriptedEngine(lambda m: "```openscad\ncube([10, 10, 4]);\n```" if m.user.startswith("Make") else "I would rather not.")
    summary = run_row(bad, "bad", "dev", **fake)
    o = summary["overall"]
    assert o["compiles"]["k"] == 3 and o["meets_request"]["k"] == 0 and o["no_code"] == {"no-code": 1}
    result = compare_rows("good", "bad", "dev", results=fake["results"])
    assert result["prompts"]["both"] == 4
    assert result["overall"]["meets_request"]["only_a"] == 4 and result["overall"]["meets_request"]["only_b"] == 0
    assert result["overall"]["iou"]["diff"] > 0.5
    assert "meets_request" in table(result)
    assert (fake["results"] / "compare" / "good__vs__bad" / "dev.json").exists()


def test_closed_test_split_in_compare_and_the_command(fake, monkeypatch):
    with pytest.raises(SplitClosed):
        compare_rows("a", "b", "test", results=fake["results"])

    def no_engine(args):
        raise AssertionError("no engine may start for a closed split")

    monkeypatch.setattr(cli, "make_engine", no_engine)
    assert cli.main(["run", "--engine", "local", "--split", "test", "--results", str(fake["results"])]) == 2
    assert cli.main(["summarize", "--row", "x", "--split", "test"]) == 2
    assert cli.main(["compare", "a", "b", "--split", "test"]) == 2
    assert cli.main(["rescore", "--row", "x", "--split", "test"]) == 2
    assert not fake["results"].exists()


def test_default_row_names():
    args = cli.parser().parse_args(["run", "--engine", "gemini", "--shots", "3"])
    assert cli.default_row(args) == "gemini-3.1-flash-lite-3shot"
    args = cli.parser().parse_args(["run", "--engine", "local"])
    assert cli.default_row(args) == "local-qwen2.5-coder-1.5b-instruct-0shot"
    args = cli.parser().parse_args(["run", "--engine", "local", "--adapter", "ml/adapters/run1"])
    assert cli.default_row(args) == "local-qwen2.5-coder-1.5b-instruct-run1-0shot"
    args = cli.parser().parse_args(["run", "--engine", "claude-code"])
    assert cli.default_row(args) == "claude-code-tools"
