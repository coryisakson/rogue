"""Stub of Rogue's stateless MCP endpoint: POST /agent/mcp/<agent>. GET -> 405.
Requires header x-rogue-agent == <agent>:<hmac token>. Logs every request as one line to LOG file."""
import hashlib, hmac, json, os, sys, time
from aiohttp import web

KEY = open(os.environ["ROGUE_AGENT_KEY_FILE"]).read().strip().encode()
LOG = os.environ.get("STUB_LOG", "stub.log")
SCHEMA = lambda props, req: {"type": "object", "properties": props, "required": req}
S = {"type": "string"}; I = {"type": "integer"}
TOOLS = {
 "get_job": ("Fetch the current job.", SCHEMA({"job_id": I}, ["job_id"])),
 "get_page_text": ("Get text of a page.", SCHEMA({"job_id": I, "page": I}, ["job_id", "page"])),
 "reocr_page": ("Re-OCR a page.", SCHEMA({"job_id": I, "page": I}, ["job_id", "page"])),
 "propose_page_repair": ("Propose repaired text.", SCHEMA({"job_id": I, "page": I, "text": S}, ["job_id", "page", "text"])),
 "mark_page_unusable": ("Mark page unusable.", SCHEMA({"job_id": I, "page": I, "reason": S}, ["job_id", "page", "reason"])),
 "preview_url": ("Preview a URL.", SCHEMA({"url": S}, ["url"])),
 "propose_text_variant": ("Propose a variant.", SCHEMA({"job_id": I, "text": S}, ["job_id", "text"])),
 "finish_job": ("Finish the job.", SCHEMA({"job_id": I, "summary": S}, ["job_id", "summary"])),
 "secret_admin_tool": ("Must never be visible.", SCHEMA({}, [])),
}

def log(**kw):
    kw["t"] = round(time.time(), 2)
    with open(LOG, "a") as f: f.write(json.dumps(kw) + "\n")

def call(name, args):
    if name == "get_job":
        r = {"job_id": 1, "kind": "quality-review", "pages": [{"page": 1, "chars": 40}], "game": "Test Game"}
    elif name == "get_page_text":
        r = {"page": args.get("page"), "text": "Pl@yers take turns rol1ing dice."}
    else:
        r = {"ok": True}
    return {"content": [{"type": "text", "text": json.dumps(r)}], "isError": False}

async def handler(req):
    agent = req.match_info["agent"]
    hdrs = {k: v for k, v in req.headers.items() if k.lower() in ("mcp-session-id", "accept", "content-type", "mcp-protocol-version", "user-agent")}
    if req.method != "POST":
        log(ev="non-post", method=req.method, agent=agent, headers=hdrs)
        return web.Response(status=405, headers={"Allow": "POST"})
    want = f"{agent}:" + hmac.new(KEY, agent.encode(), hashlib.sha256).hexdigest()
    ok = req.headers.get("x-rogue-agent") == want
    body = await req.json()
    log(ev="post", agent=agent, rpc=body.get("method"), auth=ok, headers=hdrs,
        params=body.get("params") if body.get("method") == "tools/call" else None)
    if not ok:
        return web.Response(status=401, text="bad agent header")
    if "id" not in body:
        return web.Response(status=202)
    m, rid = body["method"], body["id"]
    if m == "initialize":
        res = {"protocolVersion": body["params"].get("protocolVersion", "2025-03-26"),
               "capabilities": {"tools": {}}, "serverInfo": {"name": "stub-rogue", "version": "0"}}
    elif m == "tools/list":
        res = {"tools": [{"name": n, "description": d, "inputSchema": s} for n, (d, s) in TOOLS.items()]}
    elif m == "tools/call":
        res = call(body["params"]["name"], body["params"].get("arguments", {}))
    elif m == "ping":
        res = {}
    else:
        return web.json_response({"jsonrpc": "2.0", "id": rid, "error": {"code": -32601, "message": "no"}})
    return web.json_response({"jsonrpc": "2.0", "id": rid, "result": res})

app = web.Application()
app.router.add_route("*", "/agent/mcp/{agent}", handler)
web.run_app(app, host="127.0.0.1", port=int(os.environ.get("STUB_PORT", "4321")), print=None)
