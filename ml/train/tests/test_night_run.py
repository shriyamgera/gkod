"""The night-run script, run on short dummy commands: as a real process where that is possible, in this process where a
test has to fake the disk or the power."""

import importlib.util
import json
import os
import signal
import subprocess
import sys
import textwrap
import time
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "night-run.py"
PY = sys.executable
FAST = ["--allow-battery", "--disk-every", "0.2", "--restart-wait", "0.1", "--grace", "5"]


def load_module():
    spec = importlib.util.spec_from_file_location("night_run", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def night(tmp_path: Path, *args: str, timeout: float = 60) -> subprocess.CompletedProcess:
    cmd = [PY, str(SCRIPT), "--logs", str(tmp_path / "logs"), *FAST, *args]
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, cwd=tmp_path)


def state(tmp_path: Path, name: str) -> dict:
    return json.loads((tmp_path / "logs" / f"{name}.state.json").read_text())


def logs(tmp_path: Path, name: str) -> str:
    return "\n".join(p.read_text() for p in sorted((tmp_path / "logs").glob(f"*-{name}.log")))


def script(tmp_path: Path, name: str, body: str) -> str:
    path = tmp_path / name
    path.write_text(textwrap.dedent(body))
    return str(path)


@pytest.fixture
def keep_signals():
    saved = {s: signal.getsignal(s) for s in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP)}
    yield
    for s, handler in saved.items():
        signal.signal(s, handler)


def test_runs_a_command_awake_and_logs_it(tmp_path):
    # The command itself checks that caffeinate -dimsu is watching the night-run process (its parent).
    awake = 'pgrep -f "caffeinate -dimsu -w $PPID" > /dev/null && echo "awake: yes"'
    done = night(tmp_path, "--name", "dummy", "--", "/bin/sh", "-c", awake)
    assert done.returncode == 0, done.stdout + done.stderr
    log = logs(tmp_path, "dummy")
    assert "awake: yes" in log
    assert "command: /bin/sh -c" in log
    assert "the command exited with code 0" in log
    assert "repo commit:" in log
    s = state(tmp_path, "dummy")
    assert s["status"] == "done" and s["pid"] is None
    name = next((tmp_path / "logs").glob("*-dummy.log")).name
    assert len(name.split("-")[0]) == 8 and len(name.split("-")[1]) == 6  # <yyyymmdd>-<hhmmss>-dummy.log


def test_a_finished_run_is_not_run_again_unless_fresh(tmp_path):
    night(tmp_path, "--name", "once", "--", PY, "-c", "print('ran')")
    again = night(tmp_path, "--name", "once", "--", PY, "-c", "print('ran')")
    assert again.returncode == 0 and "already finished" in again.stdout
    assert logs(tmp_path, "once").count("\nran\n") == 1
    fresh = night(tmp_path, "--name", "once", "--fresh", "--", PY, "-c", "print('ran')")
    assert fresh.returncode == 0


def test_restarts_after_a_crash(tmp_path):
    flaky = script(
        tmp_path,
        "flaky.py",
        """
        import pathlib, sys
        mark = pathlib.Path(sys.argv[1])
        if not mark.exists():
            mark.write_text("1")
            print("first try crashes")
            sys.exit(1)
        print("second try works")
        """,
    )
    done = night(tmp_path, "--name", "flaky", "--", PY, flaky, str(tmp_path / "mark"))
    assert done.returncode == 0, done.stdout + done.stderr
    log = logs(tmp_path, "flaky")
    assert "first try crashes" in log and "second try works" in log
    assert "crashed; restart 1 of 3" in log
    assert state(tmp_path, "flaky")["restarts"] == 1


def test_gives_up_after_the_restarts(tmp_path):
    done = night(tmp_path, "--name", "broken", "--max-restarts", "2", "--", PY, "-c", "import sys; sys.exit(7)")
    assert done.returncode == 1
    log = logs(tmp_path, "broken")
    assert log.count("the command exited with code 7") == 3
    assert "giving up" in log
    assert state(tmp_path, "broken")["status"] == "failed"


def test_a_missing_command_does_not_loop(tmp_path):
    done = night(tmp_path, "--name", "missing", "--", str(tmp_path / "no-such-command"))
    assert done.returncode == 2
    assert "could not start the command" in logs(tmp_path, "missing")


def test_refuses_to_start_with_too_little_disk(tmp_path):
    done = night(tmp_path, "--name", "full", "--min-free-gb", "1000000", "--", PY, "-c", "print('ran')")
    assert done.returncode == 3 and "of disk is free" in done.stderr


def test_stops_cleanly_when_the_disk_fills_up(tmp_path, monkeypatch, keep_signals):
    module = load_module()
    readings = iter([50.0])
    monkeypatch.setattr(module, "free_gb", lambda _path: next(readings, 1.0))
    slow = script(
        tmp_path,
        "slow.py",
        """
        import signal, sys, time
        def stop(*_):
            print("saved and stopped", flush=True)
            sys.exit(0)
        signal.signal(signal.SIGTERM, stop)
        print("working", flush=True)
        time.sleep(60)
        """,
    )
    began = time.monotonic()
    code = module.main(["--name", "fills", "--logs", str(tmp_path / "logs"), *FAST, "--", PY, slow])
    assert code == 3
    assert time.monotonic() - began < 30
    log = logs(tmp_path, "fills")
    assert "under 5 GB: stopping cleanly" in log
    assert "saved and stopped" in log
    assert state(tmp_path, "fills")["status"] == "stopped-disk"


def test_kills_a_command_that_ignores_sigterm(tmp_path, monkeypatch, keep_signals):
    module = load_module()
    readings = iter([50.0])
    monkeypatch.setattr(module, "free_gb", lambda _path: next(readings, 1.0))
    stubborn = script(
        tmp_path,
        "stubborn.py",
        """
        import signal, time
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        print("ignoring", flush=True)
        time.sleep(60)
        """,
    )
    args = ["--name", "stubborn", "--logs", str(tmp_path / "logs"), *FAST, "--grace", "0.5", "--", PY, stubborn]
    assert module.main(args) == 3
    assert "sending SIGKILL" in logs(tmp_path, "stubborn")


def test_refuses_to_start_on_battery(tmp_path, monkeypatch, keep_signals):
    module = load_module()
    monkeypatch.setattr(module, "on_battery", lambda: True)
    args = ["--name", "battery", "--logs", str(tmp_path / "logs"), "--", PY, "-c", "print('ran')"]
    assert module.main(args) == 2
    assert not (tmp_path / "logs" / "battery.state.json").exists()


def test_ctrl_c_stops_the_command_and_the_run(tmp_path):
    cmd = [PY, str(SCRIPT), "--logs", str(tmp_path / "logs"), *FAST, "--name", "owner", "--", PY, "-c", "import time; time.sleep(60)"]
    run = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, cwd=tmp_path)
    deadline = time.monotonic() + 20
    while not (tmp_path / "logs").exists() or "started the command" not in logs(tmp_path, "owner"):
        assert time.monotonic() < deadline
        time.sleep(0.1)
    child = state(tmp_path, "owner")
    run.send_signal(signal.SIGINT)
    assert run.wait(timeout=20) == 130
    s = state(tmp_path, "owner")
    assert s["status"] == "stopped-owner" and child["pid"] == run.pid
    assert "got SIGINT: stopping" in logs(tmp_path, "owner")


def test_closing_the_terminal_does_not_stop_the_run(tmp_path):
    chatty = script(
        tmp_path,
        "chatty.py",
        """
        import time
        time.sleep(1)
        for i in range(2000):
            print(f"line {i}", flush=True)
        """,
    )
    cmd = [PY, str(SCRIPT), "--logs", str(tmp_path / "logs"), *FAST, "--name", "hangup", "--", PY, chatty]
    run = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, cwd=tmp_path)
    deadline = time.monotonic() + 20
    while not (tmp_path / "logs").exists() or "started the command" not in logs(tmp_path, "hangup"):
        assert time.monotonic() < deadline
        time.sleep(0.05)
    run.stdout.close()  # the terminal is gone: writing to it now fails
    run.send_signal(signal.SIGHUP)
    assert run.wait(timeout=30) == 0
    log = logs(tmp_path, "hangup")
    assert "line 1999" in log and "the command exited with code 0" in log
    assert state(tmp_path, "hangup")["status"] == "done"


TRAINER = """
import argparse, pathlib, sys
p = argparse.ArgumentParser()
p.add_argument("--out")
p.add_argument("--steps", type=int)
p.add_argument("--crash-after", type=int, default=0)
p.add_argument("--resume-from")
p.add_argument("--start", type=int, default=0)
a = p.parse_args()
out = pathlib.Path(a.out)
losses = [1.5, 0.9, 1.1, 1.0, 1.2, 1.3]
print(f"resume-from={a.resume_from and pathlib.Path(a.resume_from).name} start={a.start}", flush=True)
for step in range(a.start + 1, a.steps + 1):
    print(f"  \\x1b[38;5;244m{step:>4}\\x1b[0m    \\x1b[1;35mval\\x1b[0m \\x1b[1m{losses[step - 1]:.3f}\\x1b[0m    0.01s", flush=True)
    (out / f"{step:07d}_adapters.safetensors").write_bytes(b"w")
    (out / "adapters.safetensors").write_bytes(b"w")
    if a.crash_after and step == a.crash_after and a.resume_from is None:
        print("out of memory", flush=True)
        sys.exit(1)
"""


def test_training_keeps_the_last_two_and_the_best_and_resumes_from_the_newest(tmp_path):
    trainer = script(tmp_path, "trainer.py", TRAINER)
    ckpt = tmp_path / "adapters"
    done = night(
        tmp_path,
        "--name", "train",
        "--checkpoints", str(ckpt),
        "--resume-args", "--resume-from {checkpoint} --start {step}",
        "--",
        PY, trainer, "--out", str(ckpt), "--steps", "6", "--crash-after", "3",
    )
    assert done.returncode == 0, done.stdout + done.stderr
    log = logs(tmp_path, "train")
    assert "resume-from=None start=0" in log
    assert "out of memory" in log
    assert "resuming from 0000003_adapters.safetensors (step 3)" in log
    assert "resume-from=0000003_adapters.safetensors start=3" in log
    kept = sorted(p.name for p in ckpt.glob("*_adapters.safetensors"))
    assert kept == ["0000002_adapters.safetensors", "0000005_adapters.safetensors", "0000006_adapters.safetensors"]
    assert json.loads((ckpt / "best.json").read_text())["step"] == 2
    s = state(tmp_path, "train")
    assert s["best_step"] == 2 and s["losses"]["2"] == 0.9
    assert (ckpt / "adapters.safetensors").exists()


def test_starting_again_after_the_script_died_resumes(tmp_path):
    trainer = script(tmp_path, "trainer.py", TRAINER)
    ckpt = tmp_path / "adapters"
    ckpt.mkdir()
    (ckpt / "0000004_adapters.safetensors").write_bytes(b"w")
    logs_dir = tmp_path / "logs"
    logs_dir.mkdir()
    dead = {"status": "running", "pid": 999999, "losses": {"4": 1.0}, "logs": ["old.log"]}
    (logs_dir / "died.state.json").write_text(json.dumps(dead))
    done = night(
        tmp_path,
        "--name", "died",
        "--checkpoints", str(ckpt),
        "--resume-args", "--resume-from {checkpoint}",
        "--",
        PY, trainer, "--out", str(ckpt), "--steps", "0",
    )
    assert done.returncode == 0, done.stdout + done.stderr
    log = logs(tmp_path, "died")
    assert "(resuming: it was running)" in log
    assert "resume-from=0000004_adapters.safetensors" in log
    s = state(tmp_path, "died")
    assert s["status"] == "done" and len(s["logs"]) == 2 and s["losses"]["4"] == 1.0


def test_options_are_checked():
    for bad in (["--name", "x"], ["--name", "bad name", "--", "true"]):
        done = subprocess.run([PY, str(SCRIPT), *bad], capture_output=True, text=True)
        assert done.returncode == 2
