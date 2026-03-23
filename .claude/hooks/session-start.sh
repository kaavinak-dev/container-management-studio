#!/bin/bash
set -euo pipefail

# Only run in Claude Code Web remote sessions
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

REPO_DIR="${CLAUDE_PROJECT_DIR:-/home/user/container-management-studio}"

echo "==> Installing BFF dependencies..."
cd "$REPO_DIR/bff" && npm install

echo "==> Installing web dependencies..."
cd "$REPO_DIR/web" && npm install

echo "==> Starting stub BFF on port 3000..."
nohup node "$REPO_DIR/bff/stub.js" > "$REPO_DIR/.claude/stub-bff.log" 2>&1 &
echo "    stub BFF PID: $!"

echo "==> Starting Next.js dev server on port 3001..."
nohup bash -c "cd '$REPO_DIR/web' && npm run dev" > "$REPO_DIR/.claude/nextjs-dev.log" 2>&1 &
echo "    Next.js PID: $!"

echo "==> Preview will be available at http://localhost:3001 once Next.js finishes compiling."
echo "    Logs: $REPO_DIR/.claude/stub-bff.log  and  $REPO_DIR/.claude/nextjs-dev.log"
