import json

import pytest
from messages import THREE, ZERO

from gkod_bench.engines import gemini
from gkod_bench.engines.gemini import GeminiEngine, GeminiStop, answer_text, body, read_key

FAKE_KEY = "AQ.fake-key-for-tests-0123456789"


@pytest.fixture
def env_file(tmp_path):
    path = tmp_path / ".env"
    path.write_text(f"OTHER=1\nGEMINI_API_KEY={FAKE_KEY}\n")
    return path


def reply(text):
    return {"model": "gemini-3.1-flash-lite", "steps": [{"type": "thought", "signature": "x"}, {"type": "model_output", "content": [{"type": "text", "text": text}]}], "usage": {"total_tokens": 10}}


# ---- Gemini ----


def test_gemini_body_is_the_sites():
    assert body(ZERO, "m") == {"model": "m", "system_instruction": "SYSTEM", "input": "Make this part: a box", "store": False, "generation_config": {"thinking_level": "low"}}
    steps = body(THREE, "m", thinking=False)["input"]
    assert [t["type"] for t in steps] == ["user_input", "model_output", "user_input"]
    assert steps[1]["content"] == [{"type": "text", "text": "```openscad\ncube(1);\n```"}]
    assert "generation_config" not in body(THREE, "m", thinking=False)


def test_gemini_reads_the_answer_from_model_output_steps():
    assert answer_text(reply("```openscad\ncube(1);\n```")) == "```openscad\ncube(1);\n```"
    assert answer_text({"steps": "nope"}) == "" and answer_text(None) == ""


def test_gemini_key_comes_from_the_env_file(env_file, tmp_path):
    assert read_key(env_file) == FAKE_KEY
    (tmp_path / "empty.env").write_text("GEMINI_API_KEY=\n")
    with pytest.raises(RuntimeError) as error:
        read_key(tmp_path / "empty.env")
    assert FAKE_KEY not in str(error.value)


def test_gemini_answer_and_record_without_the_key(env_file):
    sent = []

    def sender(payload, key):
        sent.append((payload, key))
        return 200, reply("```openscad\ncube(2);\n```")

    engine = GeminiEngine(env_file=env_file, sender=sender, sleep=lambda s: None)
    answer = engine.answer(ZERO)
    assert answer.text == "```openscad\ncube(2);\n```" and answer.error is None
    assert sent[0][1] == FAKE_KEY and sent[0][0]["model"] == "gemini-3.1-flash-lite"
    assert answer.meta["reply_model"] == "gemini-3.1-flash-lite" and answer.meta["date"]
    assert FAKE_KEY not in json.dumps(answer.meta) and FAKE_KEY not in json.dumps(engine.settings())


def test_gemini_waits_and_resends_when_no_answer_came(env_file):
    statuses = iter([(429, {"error": {"message": "quota", "code": 429}}), (503, None), (200, reply("ok"))])
    sleeps = []
    engine = GeminiEngine(env_file=env_file, sender=lambda p, k: next(statuses), sleep=sleeps.append, rpm=0)
    answer = engine.answer(ZERO)
    assert answer.text == "ok" and [t["status"] for t in answer.meta["tries"]] == [429, 503]
    assert len(sleeps) == 2


def test_gemini_drops_thinking_when_the_model_refuses_it(env_file):
    bodies = []

    def sender(payload, key):
        bodies.append(payload)
        if "generation_config" in payload:
            return 400, {"error": {"message": "thinking_level is not supported for this model"}}
        return 200, reply("ok")

    answer = GeminiEngine(env_file=env_file, sender=sender, sleep=lambda s: None, rpm=0).answer(ZERO)
    assert answer.text == "ok" and len(bodies) == 2


def test_gemini_gives_up_or_stops(env_file):
    engine = GeminiEngine(env_file=env_file, sender=lambda p, k: (503, None), sleep=lambda s: None, rpm=0, retries=2)
    answer = engine.answer(ZERO)
    assert answer.text is None and len(answer.meta["tries"]) == 3
    with pytest.raises(GeminiStop):
        GeminiEngine(env_file=env_file, sender=lambda p, k: (403, {"error": {"message": "API key not valid"}}), sleep=lambda s: None, rpm=0).answer(ZERO)
    turned_down = GeminiEngine(env_file=env_file, sender=lambda p, k: (400, {"error": {"message": "blocked"}}), sleep=lambda s: None, rpm=0).answer(ZERO)
    assert turned_down.text is None and len(turned_down.meta["tries"]) == 1


def test_gemini_keeps_its_rate(env_file, monkeypatch):
    clock = [100.0]
    monkeypatch.setattr(gemini.time, "monotonic", lambda: clock[0])
    sleeps = []

    def sleep(s):
        sleeps.append(s)
        clock[0] += s

    engine = GeminiEngine(env_file=env_file, sender=lambda p, k: (200, reply("ok")), sleep=sleep, rpm=6)
    engine.answer(ZERO)
    engine.answer(ZERO)
    assert sleeps == [pytest.approx(10.0)]
