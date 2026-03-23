#!/bin/bash
set -euo pipefail

# Run in Claude Code Web remote sessions (Docker containers, Kubernetes, or explicit flag)
IS_REMOTE="${CLAUDE_CODE_REMOTE:-${CLAUDE_REMOTE:-}}"
if [ -z "$IS_REMOTE" ] && [ ! -f "/.dockerenv" ] && [ -z "${KUBERNETES_SERVICE_HOST:-}" ]; then
  echo >&2 "Not a remote session, skipping preview setup."
  exit 0
fi

REPO_DIR="${CLAUDE_PROJECT_DIR:-/home/user/container-management-studio}"

echo >&2 "==> Installing BFF dependencies..."
cd "$REPO_DIR/bff" && npm install --silent

echo >&2 "==> Installing web dependencies..."
cd "$REPO_DIR/web" && npm install --silent

echo >&2 "==> Starting stub BFF on port 3000..."
nohup node "$REPO_DIR/bff/stub.js" > "$REPO_DIR/.claude/stub-bff.log" 2>&1 &
echo >&2 "    stub BFF PID: $!"

echo >&2 "==> Starting Next.js dev server on port 3001..."
nohup bash -c "cd '$REPO_DIR/web' && npm run dev" > "$REPO_DIR/.claude/nextjs-dev.log" 2>&1 &
echo >&2 "    Next.js PID: $!"

echo >&2 "==> Waiting for Next.js to be ready on port 3001..."
MAX_WAIT=60
ELAPSED=0
until curl -sf http://localhost:3001 > /dev/null 2>&1; do
  sleep 2
  ELAPSED=$((ELAPSED + 2))
  if [ "$ELAPSED" -ge "$MAX_WAIT" ]; then
    echo >&2 "WARNING: Next.js did not become ready within ${MAX_WAIT}s."
    break
  fi
done
echo >&2 "==> Next.js is ready. Preview available at http://localhost:3001"
echo >&2 "    Logs: $REPO_DIR/.claude/stub-bff.log  and  $REPO_DIR/.claude/nextjs-dev.log"

cat <<'EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "The development preview is now running. The stub BFF is on http://localhost:3000 and the Next.js web app is on http://localhost:3001. Please open the preview panel to http://localhost:3001 so the user can interact with the UI immediately."
  }
}
EOF
