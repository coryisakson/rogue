#!/usr/bin/env bash
# Local smoke test: stub MCP + real Router + real `nanobot serve` via the supervisor.
# Needs a venv with nanobot-ai==0.3.5 (set VENV=...; created with uv if missing).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; SC="$(dirname "$HERE")"
S="${SMOKE_DIR:-${TMPDIR:-/tmp}/rogue-smoke}"; VENV="${VENV:-$S/venv}"
rm -rf "$S/work" "$S/home" "$S/stub.log"; mkdir -p "$S/work" "$S/home"
if [ ! -x "$VENV/bin/nanobot" ]; then uv venv "$VENV" -q && uv pip install -q --python "$VENV/bin/python" "nanobot-ai[api]==0.3.5"; fi
PY="$VENV/bin/python"
echo "smoke-test-key-$$" > "$S/agent-key"
export ROGUE_AGENT_KEY_FILE="$S/agent-key" ROGUE_WORK_DIR="$S/work" STUB_LOG="$S/stub.log" HOME="$S/home"
export ROGUE_MCP_URL="http://127.0.0.1:4321/agent/mcp" PATH="$VENV/bin:$PATH"
export ROGUE_AI_BASE_URL="${ROGUE_AI_BASE_URL:-http://3a77b15d.shared.olares.com/v1}"
"$PY" "$HERE/stub_mcp.py" & STUB=$!
(cd "$SC" && exec "$PY" run.py) > "$S/agents.log" 2>&1 & SUP=$!
trap 'kill $SUP $STUB 2>/dev/null || true; wait 2>/dev/null || true' EXIT
KEY="$(python3 - <<P
import hashlib,hmac
print(hmac.new(open("$S/agent-key").read().strip().encode(),b"api:reviewer",hashlib.sha256).hexdigest())
P
)"
for i in $(seq 60); do curl -sf http://127.0.0.1:8901/health >/dev/null 2>&1 && break; sleep 1; done
echo "== /health"; curl -s http://127.0.0.1:8901/health; echo
echo "== no key ->" $(curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:8901/v1/chat/completions -H 'content-type: application/json' -d '{"messages":[{"role":"user","content":"hi"}]}')
echo "== wrong key ->" $(curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:8901/v1/chat/completions -H 'authorization: Bearer nope' -H 'content-type: application/json' -d '{"messages":[{"role":"user","content":"hi"}]}')
echo "== chat"
curl -s --max-time 280 -X POST http://127.0.0.1:8901/v1/chat/completions -H "authorization: Bearer $KEY" -H 'content-type: application/json' \
 -d '{"session_id":"smoke-1","messages":[{"role":"user","content":"Job 1: run get_job then finish_job with summary ok"}]}' | head -c 1500; echo
echo "== stub log (tools/call)"; grep '"tools/call"' "$S/stub.log" || true
CALLS="$(grep -c '"rpc": "tools/call".*"auth": true' "$S/stub.log" || true)"
grep -q '"name": "get_job"' "$S/stub.log" && grep -q '"name": "finish_job"' "$S/stub.log" && echo "SMOKE PASS" || { echo "SMOKE FAIL"; tail -30 "$S/agents.log"; exit 1; }
