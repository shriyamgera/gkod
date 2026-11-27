"""Reading one generator row, without a database."""

import json

import pytest

from gkod_api.rows import MAX_LINE_BYTES, Refused, parse_line, parse_row

COMMIT = "2cac547653324254305999e393aed855006289ce"


def row(**changes):
    """A row in the generator's format, with some fields changed. A value of ... removes the field."""
    base = {
        "id": "s1-000000",
        "index": 0,
        "generator": {"name": "gkod-datagen", "version": "0.1.0", "commit": COMMIT, "dirty": False},
        "seed": 1,
        "part_seed": 1348811757,
        "family": "plate",
        "tree": {"family": "plate", "body": {"kind": "plate", "width": 65}},
        "title": "Backing plate with a hole",
        "request": "A backing plate, 7 mm thick, 65 mm wide",
        "facts": [{"key": "width", "value": 65, "unit": "mm", "axis": "x"}],
        "code": "// Backing plate\nwidth = 65; // [46:1:84]\ncube([width, 27, 7]);\n",
        "labels": {
            "compile": {"ok": True, "error": None, "triangles": 400},
            "mesh": {"size": [65, 27, 7], "min": [0, 0, 0], "volume": 12136.04},
            "checks": {"ok": True, "results": [{"id": "closed", "ok": True}, {"id": "overhang", "ok": True}]},
            "params_ok": True,
        },
    }
    for key, value in changes.items():
        if key.startswith("generator_"):
            target, key = base["generator"], key.removeprefix("generator_")
        else:
            target = base
        if value is ...:
            target.pop(key, None)
        else:
            target[key] = value
    return base


def refusal(obj) -> str:
    with pytest.raises(Refused) as caught:
        parse_row(obj)
    return caught.value.reason


def test_a_generator_row_is_read_into_columns():
    part = parse_row(row())
    assert (part.generator_name, part.generator_version, part.generator_commit) == ("gkod-datagen", "0.1.0", COMMIT)
    assert part.generator_dirty is False
    assert (part.seed, part.part_index, part.family) == (1, 0, "plate")
    assert part.title == "Backing plate with a hole"
    assert part.request.startswith("A backing plate")
    assert part.code.endswith("cube([width, 27, 7]);\n")
    assert part.facts == [{"key": "width", "value": 65, "unit": "mm", "axis": "x"}]
    assert part.tree["body"]["width"] == 65
    assert part.labels["mesh"]["volume"] == 12136.04
    assert (part.compile_ok, part.checks_ok) == (True, True)


def test_fields_without_a_column_are_kept_in_extra():
    assert parse_row(row(future_field={"a": 1})).extra == {"id": "s1-000000", "part_seed": 1348811757,
                                                          "future_field": {"a": 1}}


def test_code_is_kept_exactly_but_other_text_is_trimmed():
    part = parse_row(row(code="  cube(1);\n\n", request="  A cube  "))
    assert part.code == "  cube(1);\n\n"
    assert part.request == "A cube"


@pytest.mark.parametrize(
    "changes, reason",
    [
        ({"generator": ...}, "no generator"),
        ({"generator": "gkod-datagen"}, "no generator"),
        ({"generator_name": ...}, "no generator name"),
        ({"generator_name": "   "}, "no generator name"),
        ({"generator_version": ...}, "no generator version"),
        ({"generator_version": 1}, "generator version is not text"),
        ({"generator_commit": ...}, "no generator commit"),
        ({"generator_commit": None}, "no generator commit"),
        ({"generator_commit": "main"}, "generator commit is not a git commit id"),
        ({"generator_commit": COMMIT.upper()}, "generator commit is not a git commit id"),
        ({"seed": ...}, "no seed"),
        ({"seed": "1"}, "seed is not a whole number"),
        ({"seed": True}, "seed is not a whole number"),
        ({"seed": 1.5}, "seed is not a whole number"),
        ({"seed": 2**63}, "seed is out of range"),
        ({"index": ...}, "no index"),
        ({"index": -1}, "index is out of range"),
        ({"index": 2**31}, "index is out of range"),
        ({"request": ...}, "no request"),
        ({"request": ""}, "no request"),
        ({"request": ["a", "plate"]}, "request is not text"),
        ({"request": "x" * 4001}, "request is longer than 4,000 characters"),
        ({"code": ...}, "no code"),
        ({"code": " \n "}, "no code"),
        ({"code": "x" * 200_001}, "code is longer than 200,000 characters"),
        ({"title": "x" * 501}, "title is longer than 500 characters"),
        ({"request": "a\x00plate"}, "text contains a NUL character"),
        ({"labels": {"note\x00": 1}}, "text contains a NUL character"),
        ({"facts": [{"key": "\ud800"}]}, "text is not valid Unicode"),
    ],
)
def test_rows_without_provenance_or_with_unstorable_text_are_refused(changes, reason):
    assert refusal(row(**changes)) == reason


def test_a_whole_number_written_as_a_float_is_accepted():
    assert parse_row(row(seed=7.0, index=3.0)).part_index == 3


def test_a_dirty_generator_is_recorded_and_an_odd_one_is_unknown():
    assert parse_row(row(generator_dirty=True)).generator_dirty is True
    assert parse_row(row(generator_dirty="yes")).generator_dirty is None


def test_optional_fields_of_the_wrong_shape_are_stored_as_empty():
    part = parse_row(row(family=3, title=["x"], tree="plate", facts="wide", labels="ok"))
    assert (part.family, part.title, part.tree, part.facts) == (None, None, None, None)
    assert part.labels == {}
    assert (part.compile_ok, part.checks_ok) == (None, None)


def test_facts_may_be_an_object():
    assert parse_row(row(facts={"width": 65})).facts == {"width": 65}


@pytest.mark.parametrize(
    "labels, compile_ok, checks_ok",
    [
        # The generator's nested shape.
        ({"compile": {"ok": True}, "checks": {"ok": False, "results": []}}, True, False),
        # Results only: every check must pass.
        ({"compile": {"ok": True}, "checks": {"results": [{"id": "a", "ok": True}, {"id": "b", "ok": False}]}},
         True, False),
        ({"checks": [{"id": "a", "ok": True}, {"id": "b", "ok": True}]}, None, True),
        # The flat shape: compile_ok and an object of checks.
        ({"compile_ok": True, "checks": {"closed": True, "fits-bed": True}}, True, True),
        ({"compile_ok": True, "checks": {"closed": {"ok": True}, "overhang": {"ok": False}}}, True, False),
        ({"compile_ok": False, "checks_ok": True}, False, True),
        # A check whose result cannot be read makes the answer unknown, not a pass.
        ({"compile_ok": True, "checks": {"closed": True, "overhang": "maybe"}}, True, None),
        ({"compile_ok": True, "checks": {}}, True, None),
        # A part that did not compile has not passed the checks.
        ({"compile": {"ok": False, "error": "syntax error"}}, False, False),
        ({}, None, None),
    ],
)
def test_compile_and_check_results_are_read_from_either_label_shape(labels, compile_ok, checks_ok):
    part = parse_row(row(labels=labels))
    assert (part.compile_ok, part.checks_ok) == (compile_ok, checks_ok)


@pytest.mark.parametrize(
    "line, reason",
    [
        (b'{"index": 1,', "not valid JSON"),
        (b"\xff\xfe{}", "not valid JSON"),
        (b'{"seed": NaN}', "not valid JSON"),
        (b'{"seed": Infinity}', "not valid JSON"),
        (b"[" * 100_000 + b"]" * 100_000, "not valid JSON"),
        (b'"a string"', "not a JSON object"),
        (b"[1, 2]", "not a JSON object"),
        (b"x" * (MAX_LINE_BYTES + 1), "line is longer than 1 MB"),
    ],
)
def test_lines_that_are_not_a_json_object_are_refused(line, reason):
    with pytest.raises(Refused) as caught:
        parse_line(line)
    assert caught.value.reason == reason


def test_a_line_is_parsed_from_bytes_or_text():
    text = json.dumps(row())
    assert parse_line(text) == parse_line(text.encode())
