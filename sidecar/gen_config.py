#!/usr/bin/env python3
"""Generate one isolated Nanobot config dir per agent spec.

Layout under WORK (default /work):  <agent>/config.json, <agent>/workspace/AGENTS.md, <agent>/home/
Secrets are derived from the shared key file, never stored in git:
  mcp token = hex(HMAC-SHA256(key, agent name))
  api key   = hex(HMAC-SHA256(key, "api:" + agent name))
Running it twice with the same inputs rewrites identical files (idempotent).
"""
import hashlib
import hmac
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_MCP_URL = "http://127.0.0.1:4321/agent/mcp"
DEFAULT_BASE_URL = "http://3a77b15d.shared.olares.com/v1"
DEFAULT_MODEL = "Olares/gemma4:e4b"


def _hmac_hex(key: str, msg: str) -> str:
    return hmac.new(key.strip().encode(), msg.encode(), hashlib.sha256).hexdigest()


def mcp_token(key: str, name: str) -> str:
    return _hmac_hex(key, name)


def api_key(key: str, name: str) -> str:
    return _hmac_hex(key, "api:" + name)


def _scalar(v: str):
    v = v.strip()
    if v.isdigit():
        return int(v)
    return v.strip("'\"")


def parse_spec(text: str) -> dict:
    """Tiny frontmatter parser: `key: value` and `key: [a, b]` only (no PyYAML needed)."""
    lines = text.split("\n")
    if not lines or lines[0].strip() != "---":
        raise ValueError("spec must start with '---' frontmatter")
    end = next((i for i in range(1, len(lines)) if lines[i].strip() == "---"), None)
    if end is None:
        raise ValueError("unterminated frontmatter")
    meta: dict = {}
    for line in lines[1:end]:
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        k, _, v = line.partition(":")
        v = v.strip()
        if v.startswith("[") and v.endswith("]"):
            meta[k.strip()] = [_scalar(x) for x in v[1:-1].split(",") if x.strip()]
        else:
            meta[k.strip()] = _scalar(v)
    for req in ("name", "port", "tools"):
        if req not in meta:
            raise ValueError(f"spec missing '{req}'")
    meta["body"] = "\n".join(lines[end + 1:]).strip() + "\n"
    return meta


def load_specs(agents_dir: Path) -> list[dict]:
    return [parse_spec(p.read_text(encoding="utf-8")) for p in sorted(agents_dir.glob("*.md"))]


def _mcp_cidrs(url: str) -> list[str]:
    """Allow only the MCP host through Nanobot's SSRF guard (loopback by default)."""
    import ipaddress
    from urllib.parse import urlparse
    host = urlparse(url).hostname or "127.0.0.1"
    try:
        ipaddress.ip_address(host)
        return [host + "/32" if ":" not in host else host + "/128"]
    except ValueError:
        return ["127.0.0.1/32"]  # hostname: name must resolve to loopback or be public


def build_config(spec: dict, key: str, workspace: str, env=os.environ) -> dict:
    name = spec["name"]
    mcp_url = env.get("ROGUE_MCP_URL", DEFAULT_MCP_URL).rstrip("/")
    return {
        "agents": {"defaults": {
            "workspace": workspace,
            "provider": "custom",
            "model": env.get("ROGUE_AI_CHAT_MODEL", DEFAULT_MODEL),
            "maxTokens": 8192,  # gemma4 thinks first; small limits cut the answer off
            "temperature": 0.1,
            "maxToolIterations": int(spec.get("maxToolIterations", 30)),
            "dream": {"enabled": False},
            "idleCompactAfterMinutes": 0,
        }},
        "providers": {"custom": {
            "apiBase": env.get("ROGUE_AI_BASE_URL") or DEFAULT_BASE_URL,
            "apiKey": "none",  # Router needs no key; some clients refuse an empty one
        }},
        "transcription": {"enabled": False},
        "gateway": {"host": "127.0.0.1", "heartbeat": {"enabled": False}},
        "api": {"host": "127.0.0.1", "port": int(spec["port"]),
                "timeout": 1500.0, "apiKey": api_key(key, name)},
        "tools": {
            "web": {"enable": False},
            "exec": {"enable": False},
            "file": {"enable": False},
            "cliApps": {"enable": False},
            "my": {"enable": False},
            "imageGeneration": {"enabled": False},
            "restrictToWorkspace": True,
            # Nanobot blocks private addresses (SSRF guard); the Rogue MCP endpoint is pod-local.
            "ssrfWhitelist": _mcp_cidrs(mcp_url),
            "webuiAllowLocalServiceAccess": False,
            "webuiAllowRemotePackageInstall": False,
            "mcpServers": {"rogue": {
                "type": "streamableHttp",
                "url": f"{mcp_url}/{name}",
                "headers": {"x-rogue-agent": f"{name}:{mcp_token(key, name)}"},
                "toolTimeout": 60,
                "enabledTools": list(spec["tools"]),
            }},
        },
    }


def _write_if_changed(path: Path, content: str, mode: int = 0o600) -> None:
    if path.exists() and path.read_text(encoding="utf-8") == content:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    path.chmod(mode)


def generate(agents_dir: Path, work: Path, key: str, env=os.environ) -> list[dict]:
    specs = load_specs(agents_dir)
    for spec in specs:
        base = work / spec["name"]
        ws = base / "workspace"
        (base / "home").mkdir(parents=True, exist_ok=True)
        ws.mkdir(parents=True, exist_ok=True)
        cfg = build_config(spec, key, str(ws), env)
        _write_if_changed(base / "config.json", json.dumps(cfg, indent=2, sort_keys=True) + "\n")
        # Nanobot injects workspace AGENTS.md into the system prompt (agent/context.py).
        _write_if_changed(ws / "AGENTS.md", spec["body"], 0o644)
        spec["dir"] = str(base)
    return specs


def read_key(path: str) -> str:
    key = Path(path).read_text(encoding="utf-8").strip()
    if not key:
        raise ValueError("agent key file is empty")
    return key


def main() -> int:
    key = read_key(os.environ.get("ROGUE_AGENT_KEY_FILE", "/agent-share/agent-key"))
    work = Path(os.environ.get("ROGUE_WORK_DIR", "/work"))
    agents = Path(os.environ.get("ROGUE_AGENTS_DIR", str(HERE / "agents")))
    for s in generate(agents, work, key):
        print(f"configured {s['name']} on 127.0.0.1:{s['port']}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
