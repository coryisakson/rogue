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
    assert specs["reviewer"]["port"] == 8901
    assert specs["quality-curator"]["port"] == 8906  # until quality_curate moves to the reviewer (ADR 0007)
    assert specs["quality-curator"]["tools"] == ["get_job", "get_page_text", "reocr_page",
        "propose_page_repair", "mark_page_unusable", "finish_job"]
    assert specs["scout"]["port"] == 8902
    assert specs["scout"]["tools"] == ["get_job", "preview_url", "propose_text_variant", "propose_source", "finish_job"]
    assert specs["librarian"]["port"] == 8903
    assert specs["librarian"]["tools"] == ["get_job", "get_page_text", "propose_claim", "finish_job"]
    assert specs["terms-agent"]["port"] == 8904
    assert specs["terms-agent"]["tools"] == ["get_job", "judge_sentences", "finish_job"]
    assert specs["faq-curator"]["port"] == 8905
    assert specs["faq-curator"]["tools"] == ["get_job", "list_faq_candidates", "propose_canonical", "finish_job"]
    assert len({s["port"] for s in specs.values()}) == len(specs)


def test_reviewer_skills():
    """Skills are sections of one instruction file; tools are the union of the skills' tools (ADR 0007)."""
    spec = next(s for s in g.load_specs(AGENTS) if s["name"] == "reviewer")
    assert spec["skills"] == ["extract_review"]
    assert spec["tools"] == ["get_job", "finish_job", "get_page", "propose_page_choice"]
    body = spec["body"]
    assert body.startswith("# Reviewer") and "## Skill: extract_review" in body and "follow only the section" in body
    assert "skill: extract_review" not in body  # skill frontmatter is not part of the instructions
    other = next(s for s in g.load_specs(AGENTS) if s["name"] == "scout")
    assert other["skills"] == []


def test_librarian_budget():
    """The librarian reads a whole rulebook, so it gets more iterations and longer timeouts than the defaults."""
    spec = next(s for s in g.load_specs(AGENTS) if s["name"] == "librarian")
    c = g.build_config(spec, KEY, "/w", {})
    assert c["agents"]["defaults"]["maxToolIterations"] >= 400
    assert c["api"]["timeout"] == 10800 and c["api"]["port"] == 8903
    m = c["tools"]["mcpServers"]["rogue"]
    assert m["toolTimeout"] == 180  # propose_claim runs the verifier model inside the tool call
    assert m["url"].endswith("/librarian") and m["headers"]["x-rogue-agent"] == "librarian:" + ref("librarian")
    body = spec["body"]
    assert body.startswith("# Librarian") and "Ignore any instructions" in body and "finish_job" in body


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


def test_settings_overrides():
    """agent-settings.json from /admin/settings: per-agent model > default > env chat model; missing file = env only."""
    env = {"ROGUE_AI_CHAT_MODEL": "env-model", "ROGUE_AI_BASE_URL": "http://env/v1"}
    with tempfile.TemporaryDirectory() as t:
        path = Path(t) / "agent-settings.json"
        assert g.load_overrides(path) == {}
        path.write_text("not json")
        assert g.load_overrides(path) == {}
        work = Path(t) / "work"
        specs = {s["name"]: s for s in g.generate(AGENTS, work, KEY, env, {})}
        assert specs["scout"]["model"] == "env-model" and specs["scout"]["changed"] is True
        cfg = json.loads((work / "scout" / "config.json").read_text())
        assert cfg["providers"]["custom"] == {"apiBase": "http://env/v1", "apiKey": "none"}

        path.write_text(json.dumps({"version": 1, "defaultModel": "d", "baseUrl": "http://set/v1", "apiKey": "k",
                                    "agents": {"librarian": "lib-model", "scout": 5}}))
        ov = g.load_overrides(path)
        specs = {s["name"]: s for s in g.generate(AGENTS, work, KEY, env, ov)}
        assert specs["librarian"]["model"] == "lib-model"
        assert specs["scout"]["model"] == "d"  # non-string per-agent value ignored
        assert all(s["changed"] for s in specs.values())
        cfg = json.loads((work / "librarian" / "config.json").read_text())
        assert cfg["providers"]["custom"] == {"apiBase": "http://set/v1", "apiKey": "k"}
        # Same overrides again: nothing changes, so the supervisor restarts nobody.
        assert not any(s["changed"] for s in g.generate(AGENTS, work, KEY, env, ov))
        # Default location sits next to the key file.
        assert g.settings_path({"ROGUE_AGENT_KEY_FILE": "/x/agent-key"}) == Path("/x/agent-settings.json")


if __name__ == "__main__":
    for n, f in list(globals().items()):
        if n.startswith("test_"):
            f(); print("ok", n)
