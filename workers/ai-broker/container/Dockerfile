# The AI broker's container (workers/ai-broker/worker.js): the Codex CLI, the Claude Code CLI and the call server, run as an unprivileged user.
# Why (28 Oct 2026, spec ci-on-codex-subscription-design): codex never runs as root and has no shell tool; the login file is mode 0600 for this user only. The image holds no secret.
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/* && npm install -g @openai/codex@0.162.1 @anthropic-ai/claude-code@2.1.316 && useradd -m -u 1001 codex
COPY container/server.mjs container/weekly.mjs container/claude.mjs container/threads.mjs /app/container/
COPY lib/args.mjs /app/lib/
USER codex
ENV CODEX_HOME=/home/codex/.codex
EXPOSE 8080
CMD ["node", "/app/container/server.mjs"]
