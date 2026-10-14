#!/usr/bin/env python3
"""Wait for the GitHub Actions run for a given commit SHA (default HEAD) and report success/failure.
Usage: scripts/monitor-actions.py [sha] ; needs GITHUB_TOKEN (from /opt/data/.env on the Hermes host)."""
import json, os, subprocess, sys, time, urllib.request

OWNER, REPO = "coryisakson", "rogue"

def api(path, token):
    req = urllib.request.Request(f"https://api.github.com/repos/{OWNER}/{REPO}/{path}", headers={
        "Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)

def main():
    token = os.environ.get("GITHUB_TOKEN") or sys.exit("GITHUB_TOKEN not set")
    sha = sys.argv[1] if len(sys.argv) > 1 else subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
    deadline = time.time() + 1500
    while time.time() < deadline:
        runs = api(f"actions/runs?head_sha={sha}", token).get("workflow_runs", [])
        if runs:
            run = runs[0]
            print(f"{run['name']} #{run['run_number']}: {run['status']} {run.get('conclusion') or ''}", flush=True)
            if run["status"] == "completed":
                print(run["html_url"])
                sys.exit(0 if run["conclusion"] == "success" else 1)
        else:
            print("no run yet", flush=True)
        time.sleep(15)
    print("timeout waiting for CI"); sys.exit(2)

main()
