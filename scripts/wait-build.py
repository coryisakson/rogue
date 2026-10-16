#!/usr/bin/env python3
"""Wait until EVERY GitHub Actions run for a commit (CI and 'Build and Push Docker Image') finishes.
Prints one final line per workflow; progress is silent so it costs almost no context.
Usage: scripts/wait-build.py [sha]   needs GITHUB_TOKEN (source /opt/data/.env). Exit 0 only if all succeeded."""
import json, os, subprocess, sys, time, urllib.request
OWNER, REPO = "coryisakson", "rogue"
def api(path, token):
    req = urllib.request.Request(f"https://api.github.com/repos/{OWNER}/{REPO}/{path}", headers={
        "Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(req, timeout=30) as r: return json.load(r)
token = os.environ.get("GITHUB_TOKEN") or sys.exit("GITHUB_TOKEN not set")
sha = sys.argv[1] if len(sys.argv) > 1 else subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
end = time.time() + 1500; runs = []
while time.time() < end:
    try: runs = api(f"actions/runs?head_sha={sha}", token).get("workflow_runs", [])
    except Exception: runs = []; time.sleep(15); continue
    if len(runs) >= 2 and all(r["status"] == "completed" for r in runs): break
    time.sleep(15)
for r in runs: print(f"{r['name']}: {r['status']} {r.get('conclusion') or ''}")
ok = len(runs) >= 2 and all(r.get("conclusion") == "success" for r in runs)
print("ALL GREEN" if ok else "NOT GREEN or timed out"); sys.exit(0 if ok else 1)
