"""Run one long job overnight: the Mac stays awake, everything goes to a log, and the job is watched.

    ml/.venv/bin/python ml/scripts/night-run.py --name NAME [options] -- COMMAND [ARGS ...]

- The Mac cannot sleep while the run lasts: `caffeinate -dimsu -w <this process>` holds it awake until this script
  exits, through the command and any restart. (caffeinate watches the process instead of starting the command itself
  because macOS strips DYLD_* settings from anything started by a system program, and this Mac's Python needs one.)
- Everything the command prints, and every step of this script, goes to results/logs/<date>-<time>-<name>.log.
- Free disk is checked every few minutes (--disk-every). Under --min-free-gb (5) the command gets SIGTERM, then
  SIGKILL after --grace seconds, and the run stops; it is not restarted.
- A crash (any exit code but 0) is restarted, up to --max-restarts times, after --restart-wait seconds. Starting the
  same --name again after the Mac or this script died resumes it: results/logs/<name>.state.json remembers the run.
  The command must pick up where it left off by itself (the benchmark skips rows it has already written). For a
  training run, --resume-args adds arguments on a restart, with {checkpoint} and {step} filled in from the newest
  checkpoint in --checkpoints.
- For a training run, --checkpoints keeps only the last two step checkpoints and the one with the lowest validation
  loss (see ml/train/checkpoints.py); the rest are deleted at every disk check and at the end.
- It refuses to start on battery unless --allow-battery is given.

Exit codes: 0 finished, 1 still failing after the restarts, 2 could not start, 3 stopped for low disk, 130 stopped by
the owner (Ctrl-C or SIGTERM).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import shutil
import signal
import subprocess
import sys
import threading
import time
from datetime import datetime
from pathlib import Path

ML = Path(__file__).resolve().parent.parent
REPO = ML.parent
sys.path.insert(0, str(ML))

from train.checkpoints import find_checkpoints, prune, read_loss_file, read_val_loss, strip_ansi  # noqa: E402

GB = 1024**3
NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
EXIT_DONE, EXIT_FAILED, EXIT_NOSTART, EXIT_DISK, EXIT_OWNER = 0, 1, 2, 3, 130


def parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(prog="night-run", description="Run one long job overnight, awake, logged and watched.")
    p.add_argument("--name", required=True, help="name of the run, used for its log and state file")
    p.add_argument("--logs", type=Path, default=REPO / "results" / "logs", help="folder for logs (results/logs)")
    p.add_argument("--min-free-gb", type=float, default=5.0, help="stop when free disk falls under this (5)")
    p.add_argument("--disk-every", type=float, default=180.0, help="seconds between disk checks (180)")
    p.add_argument("--disk-path", type=Path, default=REPO, help="a path on the disk to watch (the repo)")
    p.add_argument("--max-restarts", type=int, default=3, help="restarts after a crash (3)")
    p.add_argument("--restart-wait", type=float, default=30.0, help="seconds to wait before a restart (30)")
    p.add_argument("--grace", type=float, default=120.0, help="seconds between SIGTERM and SIGKILL (120)")
    p.add_argument("--checkpoints", type=Path, help="training checkpoint folder to prune and resume from")
    p.add_argument("--keep-last", type=int, default=2, help="step checkpoints kept besides the best (2)")
    p.add_argument("--resume-args", default="", help="arguments added on a restart, e.g. '--resume-adapter-file {checkpoint}'")
    p.add_argument("--allow-battery", action="store_true", help="start even when the Mac is on battery")
    p.add_argument("--fresh", action="store_true", help="start over instead of resuming an earlier run of this name")
    p.add_argument("command", nargs=argparse.REMAINDER, help="-- then the command to run")
    args = p.parse_args(argv)
    if args.command and args.command[0] == "--":
        args.command = args.command[1:]
    if not args.command:
        p.error("give the command after --")
    if not NAME.match(args.name):
        p.error("--name may use letters, digits, '.', '_' and '-' only")
    return args


def free_gb(path: Path) -> float:
    probe = path
    while not probe.exists():
        probe = probe.parent
    return shutil.disk_usage(probe).free / GB


def on_battery() -> bool:
    try:
        out = subprocess.run(["pmset", "-g", "batt"], capture_output=True, text=True, timeout=10).stdout
    except (OSError, subprocess.SubprocessError):
        return False
    return "Battery Power" in out.splitlines()[0] if out else False


def git_commit() -> str:
    try:
        head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=REPO, capture_output=True, text=True, timeout=10).stdout.strip()
        dirty = subprocess.run(["git", "status", "--porcelain"], cwd=REPO, capture_output=True, text=True, timeout=10).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return "unknown"
    return f"{head}{' (uncommitted changes)' if dirty else ''}" if head else "unknown"


def process_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    out = subprocess.run(["ps", "-p", str(pid), "-o", "command="], capture_output=True, text=True).stdout
    return "night-run" in out


class Run:
    def __init__(self, args: argparse.Namespace):
        self.args = args
        self.started = datetime.now()
        args.logs.mkdir(parents=True, exist_ok=True)
        self.log_path = args.logs / f"{self.started:%Y%m%d-%H%M%S}-{args.name}.log"
        self.state_path = args.logs / f"{args.name}.state.json"
        self.log_lock = threading.RLock()
        self.log_file = None
        self.child: subprocess.Popen | None = None
        self.stop_reason: str | None = None
        self.stop_event = threading.Event()
        self.losses: dict[int, float] = {}
        self.state: dict = {}

    # Log and state

    def say(self, message: str) -> None:
        line = f"[night-run {datetime.now():%Y-%m-%d %H:%M:%S}] {message}\n"
        with self.log_lock:
            if self.log_file:
                self.log_file.write(line)
                self.log_file.flush()
            sys.stdout.write(line)
            sys.stdout.flush()

    def save_state(self, **changes) -> None:
        self.state.update(changes)
        self.state["losses"] = {str(k): v for k, v in sorted(self.losses.items())}
        self.state["updated"] = datetime.now().isoformat(timespec="seconds")
        tmp = self.state_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.state, indent=2) + "\n")
        tmp.replace(self.state_path)

    def load_state(self) -> dict:
        if not self.state_path.is_file():
            return {}
        try:
            return json.loads(self.state_path.read_text())
        except (OSError, ValueError):
            return {}

    # The command

    def command_for(self, resuming: bool) -> list[str]:
        cmd = list(self.args.command)
        if resuming and self.args.resume_args and self.args.checkpoints:
            found = find_checkpoints(self.args.checkpoints)
            if found:
                latest = found[-1]
                extra = self.args.resume_args.format(checkpoint=str(latest.path), step=latest.step)
                cmd += shlex.split(extra)
                self.say(f"resuming from {latest.path.name} (step {latest.step})")
            else:
                self.say("no checkpoint yet, so the command starts from the beginning")
        return cmd

    def pump(self, stream) -> None:
        for raw in iter(stream.readline, b""):
            text = raw.decode("utf-8", errors="replace")
            for piece in text.replace("\r", "\n").splitlines():
                clean = strip_ansi(piece).rstrip()
                if not clean.strip():
                    continue
                if (found := read_val_loss(clean)) is not None:
                    self.losses[found[0]] = found[1]
                with self.log_lock:
                    if self.log_file:
                        self.log_file.write(clean + "\n")
                        self.log_file.flush()
            sys.stdout.write(text)
            sys.stdout.flush()
        stream.close()

    def stop_child(self, reason: str) -> None:
        if self.stop_reason is None:
            self.stop_reason = reason
        self.stop_event.set()
        child = self.child
        if child is None or child.poll() is not None:
            return
        try:
            os.killpg(child.pid, signal.SIGTERM)
        except ProcessLookupError:
            return
        self.say(f"sent SIGTERM to the command (pid {child.pid}); SIGKILL in {self.args.grace:g} s if it is still running")

    def wait_child(self) -> int:
        child = self.child
        assert child is not None
        next_disk = time.monotonic() + self.args.disk_every
        term_at: float | None = None
        while True:
            code = child.poll()
            if code is not None:
                return code
            now = time.monotonic()
            if self.stop_reason and term_at is None:
                term_at = now
            if term_at is not None and now - term_at > self.args.grace:
                self.say("the command did not stop in time; sending SIGKILL")
                try:
                    os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                term_at = float("inf")
            if now >= next_disk:
                next_disk = now + self.args.disk_every
                self.tick()
            time.sleep(min(0.5, max(self.args.disk_every / 4, 0.05)))

    def tick(self) -> None:
        if self.args.checkpoints:
            self.prune()
        free = free_gb(self.args.disk_path)
        if free < self.args.min_free_gb and self.stop_reason is None:
            self.say(f"free disk is {free:.1f} GB, under {self.args.min_free_gb:g} GB: stopping cleanly")
            self.stop_child("disk")
        self.save_state(free_gb=round(free, 2))

    def prune(self) -> None:
        folder = self.args.checkpoints
        self.losses.update(read_loss_file(folder))
        result = prune(folder, self.losses, keep_last=self.args.keep_last)
        if result["deleted"]:
            self.say(f"checkpoints: deleted steps {result['deleted']}, kept {result['kept']}, best {result['best']}")
        self.state["best_step"] = result["best"]

    def on_signal(self, signum, _frame) -> None:
        self.say(f"got {signal.Signals(signum).name}: stopping")
        self.stop_child("owner")

    # The night

    def refuse(self, message: str, code: int = EXIT_NOSTART) -> int:
        sys.stderr.write(f"night-run: {message}\n")
        return code

    def main(self) -> int:
        args = self.args
        previous = self.load_state()
        if previous.get("status") == "running" and previous.get("pid") and process_alive(int(previous["pid"])):
            return self.refuse(f"'{args.name}' is already running (pid {previous['pid']}).")
        if previous.get("status") == "done" and not args.fresh:
            print(f"night-run: '{args.name}' already finished ({previous.get('updated')}). Use --fresh to run it again.")
            return EXIT_DONE
        battery = on_battery()
        if battery and not args.allow_battery:
            return self.refuse("the Mac is on battery. Plug it in, or pass --allow-battery.")
        free = free_gb(args.disk_path)
        if free < args.min_free_gb:
            return self.refuse(f"only {free:.1f} GB of disk is free; at least {args.min_free_gb:g} GB is needed.", EXIT_DISK)
        if args.checkpoints:
            args.checkpoints.mkdir(parents=True, exist_ok=True)

        resuming = bool(previous) and not args.fresh
        if resuming:
            self.losses = {int(k): float(v) for k, v in previous.get("losses", {}).items()}
            self.state = {k: v for k, v in previous.items() if k not in ("pid",)}
        self.state.setdefault("name", args.name)
        self.state.setdefault("first_started", self.started.isoformat(timespec="seconds"))
        self.state.setdefault("logs", [])
        self.state["logs"].append(self.log_path.name)

        self.log_file = self.log_path.open("a", encoding="utf-8")
        caffeinate = subprocess.Popen(["caffeinate", "-dimsu", "-w", str(os.getpid())])
        signal.signal(signal.SIGINT, self.on_signal)
        signal.signal(signal.SIGTERM, self.on_signal)
        self.save_state(status="running", pid=os.getpid(), command=args.command, cwd=os.getcwd())

        self.say(f"run '{args.name}'{' (resuming: it was ' + str(previous.get('status')) + ')' if resuming else ''}")
        self.say(f"command: {shlex.join(args.command)}")
        self.say(f"working folder: {os.getcwd()}")
        self.say(f"repo commit: {git_commit()}")
        self.say(f"python: {sys.version.split()[0]}; free disk {free:.1f} GB; power: {'battery' if battery else 'plugged in'}")
        self.say(f"awake: caffeinate -dimsu -w {os.getpid()} (pid {caffeinate.pid})")
        self.say(f"disk checked every {args.disk_every:g} s, stop under {args.min_free_gb:g} GB; up to {args.max_restarts} restarts")

        began = time.monotonic()
        restarts = 0
        code = EXIT_FAILED
        try:
            while True:
                cmd = self.command_for(resuming or restarts > 0)
                env = dict(os.environ, PYTHONUNBUFFERED="1")
                try:
                    self.child = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True, env=env)
                except OSError as err:
                    self.say(f"could not start the command: {err}")
                    self.save_state(status="failed", exit=None, reason=str(err))
                    code = EXIT_NOSTART
                    break
                self.say(f"started the command (pid {self.child.pid}), try {restarts + 1}")
                reader = threading.Thread(target=self.pump, args=(self.child.stdout,), daemon=True)
                reader.start()
                exit_code = self.wait_child()
                reader.join(timeout=10)
                if args.checkpoints:
                    self.prune()
                self.say(f"the command exited with code {exit_code}")

                if self.stop_reason == "disk":
                    self.save_state(status="stopped-disk", exit=exit_code)
                    code = EXIT_DISK
                    break
                if self.stop_reason == "owner":
                    self.save_state(status="stopped-owner", exit=exit_code)
                    code = EXIT_OWNER
                    break
                if exit_code == 0:
                    self.save_state(status="done", exit=0)
                    code = EXIT_DONE
                    break
                if restarts >= args.max_restarts:
                    self.say(f"still failing after {restarts} restarts: giving up")
                    self.save_state(status="failed", exit=exit_code)
                    code = EXIT_FAILED
                    break
                restarts += 1
                self.save_state(status="running", exit=exit_code, restarts=self.state.get("restarts", 0) + 1)
                self.say(f"crashed; restart {restarts} of {args.max_restarts} in {args.restart_wait:g} s")
                if self.stop_event.wait(args.restart_wait):
                    self.save_state(status="stopped-owner" if self.stop_reason == "owner" else "stopped-disk")
                    code = EXIT_OWNER if self.stop_reason == "owner" else EXIT_DISK
                    break
                if free_gb(args.disk_path) < args.min_free_gb:
                    self.say(f"free disk is under {args.min_free_gb:g} GB: not restarting")
                    self.save_state(status="stopped-disk")
                    code = EXIT_DISK
                    break
        finally:
            took = int(time.monotonic() - began)
            best = self.state.get("best_step")
            ran = f"{took // 3600}:{took % 3600 // 60:02d}:{took % 60:02d}"
            self.say(f"finished: {self.state.get('status')} after {ran}{f'; best checkpoint step {best}' if best is not None else ''}")
            self.save_state(pid=None)
            caffeinate.terminate()
            self.log_file.close()
        return code


def main(argv: list[str] | None = None) -> int:
    return Run(parse_args(sys.argv[1:] if argv is None else argv)).main()


if __name__ == "__main__":
    sys.exit(main())
