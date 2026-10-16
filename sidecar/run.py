#!/usr/bin/env python3
"""Supervisor: wait for the shared key, generate configs, run one `nanobot serve` per agent.

Restarts crashed children with exponential backoff; exits 1 if every child has given up
(too many quick crashes); forwards SIGTERM/SIGINT to children.
"""
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

import gen_config

KEY_FILE = os.environ.get("ROGUE_AGENT_KEY_FILE", "/agent-share/agent-key")
WAIT_S = int(os.environ.get("ROGUE_KEY_WAIT_S", "600"))
MAX_QUICK_FAILS = int(os.environ.get("ROGUE_MAX_QUICK_FAILS", "8"))
STABLE_S = 60  # a child that ran this long resets its failure count

stopping = False


def log(msg: str) -> None:
    print(f"[agents] {msg}", flush=True)


def wait_for_key() -> str:
    deadline = time.time() + WAIT_S
    announced = False
    while not stopping and time.time() < deadline:
        try:
            return gen_config.read_key(KEY_FILE)
        except (OSError, ValueError):
            if not announced:
                log(f"waiting for key file {KEY_FILE} (written by the web app)")
                announced = True
            time.sleep(2)
    raise SystemExit(f"key file {KEY_FILE} did not appear within {WAIT_S}s")


class Child:
    def __init__(self, spec: dict):
        self.spec = spec
        self.name = spec["name"]
        self.proc = None
        self.fails = 0
        self.started = 0.0
        self.next_start = 0.0
        self.dead = False

    def start(self) -> None:
        base = Path(self.spec["dir"])
        env = {  # minimal environment: no inherited secrets
            "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
            "HOME": str(base / "home"),
            "TMPDIR": str(base / "home"),
            "PYTHONUNBUFFERED": "1",
            "PYTHONDONTWRITEBYTECODE": "1",
            "NO_PROXY": "127.0.0.1,localhost",
        }
        for k in ("ROGUE_AI_BASE_URL", "SSL_CERT_FILE", "HTTP_PROXY", "HTTPS_PROXY"):
            if k in os.environ:
                env[k] = os.environ[k]
        cmd = ["nanobot", "serve", "--host", "127.0.0.1", "--port", str(self.spec["port"]),
               "--config", str(base / "config.json"), "--workspace", str(base / "workspace")]
        self.proc = subprocess.Popen(cmd, env=env, cwd=str(base))
        self.started = time.time()
        log(f"started {self.name} pid={self.proc.pid} port={self.spec['port']}")

    def poll(self) -> None:
        if self.dead or self.proc is None:
            return
        code = self.proc.poll()
        if code is None:
            return
        ran = time.time() - self.started
        self.fails = 0 if ran >= STABLE_S else self.fails + 1
        self.proc = None
        if self.fails >= MAX_QUICK_FAILS:
            self.dead = True
            log(f"{self.name} exited ({code}) too often; giving up")
            return
        delay = min(60, 2 ** self.fails)
        self.next_start = time.time() + delay
        log(f"{self.name} exited ({code}) after {ran:.0f}s; restart in {delay}s")


def main() -> int:
    global stopping

    def on_signal(signum, _frame):
        global stopping
        stopping = True

    signal.signal(signal.SIGTERM, on_signal)
    signal.signal(signal.SIGINT, on_signal)

    key = wait_for_key()
    work = Path(os.environ.get("ROGUE_WORK_DIR", "/work"))
    agents_dir = Path(os.environ.get("ROGUE_AGENTS_DIR", str(Path(__file__).parent / "agents")))
    specs = gen_config.generate(agents_dir, work, key)
    children = [Child(s) for s in specs]
    log("key found; agents: " + ", ".join(c.name for c in children))
    for c in children:
        c.start()

    while not stopping:
        for c in children:
            c.poll()
            if not c.dead and c.proc is None and time.time() >= c.next_start:
                c.start()
        if all(c.dead for c in children):
            log("all agents dead; exiting")
            return 1
        time.sleep(1)

    log("stopping; forwarding SIGTERM")
    for c in children:
        if c.proc and c.proc.poll() is None:
            c.proc.terminate()
    end = time.time() + 15
    for c in children:
        if c.proc:
            try:
                c.proc.wait(timeout=max(0.1, end - time.time()))
            except subprocess.TimeoutExpired:
                c.proc.kill()
    return 0


if __name__ == "__main__":
    sys.exit(main())
