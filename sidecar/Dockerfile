FROM python:3.12-slim

ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1 PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1

# Pinned: config schema and CLI flags are probed against this exact release (ADR 0002).
RUN pip install "nanobot-ai[api]==0.3.5" \
 && useradd --uid 1000 --create-home --shell /usr/sbin/nologin agent \
 && mkdir /work && chown 1000:1000 /work

WORKDIR /opt/rogue-agents
COPY VERSION gen_config.py run.py entrypoint.sh ./
COPY agents ./agents

USER 1000
ENV ROGUE_WORK_DIR=/work ROGUE_AGENT_KEY_FILE=/agent-share/agent-key \
    ROGUE_MCP_URL=http://127.0.0.1:4321/agent/mcp \
    ROGUE_AI_CHAT_MODEL=Olares/gemma4:e4b

# /health is open on each agent port (127.0.0.1 inside the pod).
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD python -c "import urllib.request as u;[u.urlopen('http://127.0.0.1:%d/health'%p,timeout=3) for p in (8901,8902,8903,8904,8905)]"

ENTRYPOINT ["/opt/rogue-agents/entrypoint.sh"]
