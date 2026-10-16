"""Run: python sidecar/test/test_gen_config.py   (or pytest). Stdlib only."""
import hashlib, hmac, json, sys, tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import gen_config as g

AGENTS = Path(__file__).resolve().parent.parent / "agents"
KEY = "  s3cret-key\n"


def ref(msg):
    return hmac.new(b"s3cret-key", msg.encode(), hashlib.sha256).hexdigest()


def test_derivation():
    assert g.mcp_token(KEY, "scout") == ref("scout")
    assert g.api_key(KEY, "scout") == ref("api:scout")
    assert g.mcp_token(KEY, "scout") != g.api_key(KEY, "scout")


def test_specs_and_tools():
    specs = {s["name"]: s for s in g.load_specs(AGENTS)}
    assert specs["quality-curator"]["port"] == 8901
    assert specs["quality-curator"]["tools"] == ["get_job", "get_page_text", "reocr_page",
        "propose_page_repair", "mark_page_unusable", "finish_job"]
    assert specs["scout"]["port"] == 8902
    assert specs["scout"]["tools"] == ["get_job", "preview_url", "propose_text_variant", "finish_job"]


def test_generate_idempotent_and_locked_down():
    with tempfile.TemporaryDirectory() as t:
        env = {"ROGUE_MCP_URL": "http://x:1/agent/mcp/", "ROGUE_AI_BASE_URL": "http://r/v1"}
        g.generate(AGENTS, Path(t), KEY, env)
        p = Path(t) / "scout" / "config.json"
        first = p.read_text(); mtime = p.stat().st_mtime_ns
        g.generate(AGENTS, Path(t), KEY, env)
        assert p.read_text() == first and p.stat().st_mtime_ns == mtime
        c = json.loads(first)
        m = c["tools"]["mcpServers"]["rogue"]
        assert m["url"] == "http://x:1/agent/mcp/scout"
        assert m["headers"]["x-rogue-agent"] == "scout:" + ref("scout")
        assert c["api"]["apiKey"] == ref("api:scout") and c["api"]["host"] == "127.0.0.1"
        assert c["api"]["port"] == 8902 and c["providers"]["custom"]["apiBase"] == "http://r/v1"
        for t_ in ("exec", "file", "cliApps", "my", "web"):
            assert c["tools"][t_]["enable"] is False
        assert c["api"]["timeout"] == 1500 and m["toolTimeout"] == 60
        assert c["tools"]["restrictToWorkspace"] is True
        assert c["agents"]["defaults"]["dream"]["enabled"] is False
        assert (Path(t) / "scout" / "workspace" / "AGENTS.md").read_text().startswith("# Scout")
        assert KEY.strip() not in first


if __name__ == "__main__":
    for n, f in list(globals().items()):
        if n.startswith("test_"):
            f(); print("ok", n)
