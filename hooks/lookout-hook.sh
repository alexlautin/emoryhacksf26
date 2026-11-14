#!/bin/sh
# Lookout hook forwarder. Claude Code pipes the hook JSON on stdin; this POSTs it
# to the local Lookout server and prints the JSON answer.
# If Lookout isn't running, PreToolUse fails closed (exit 2 blocks the tool call)
# unless LOOKOUT_FAIL_OPEN=1 (or the old SEATBELT_FAIL_OPEN=1). Other events fail open.
EVENT="$1"
PORT="${LOOKOUT_PORT:-${SEATBELT_PORT:-4100}}"
FAIL_OPEN="${LOOKOUT_FAIL_OPEN:-${SEATBELT_FAIL_OPEN:-0}}"
RESP=$(curl -sS --fail --max-time 110 \
  -H 'Content-Type: application/json' \
  -H "X-Lookout-Project: ${CLAUDE_PROJECT_DIR:-}" \
  --data-binary @- "http://127.0.0.1:${PORT}/hooks/${EVENT}" 2>/dev/null)
if [ $? -ne 0 ]; then
  if [ "$EVENT" = "pre-tool" ] && [ "$FAIL_OPEN" != "1" ]; then
    echo "Lookout isn't running, so this action was blocked. Start it with: pnpm start (in the Lookout folder)" >&2
    exit 2
  fi
  exit 0
fi
printf '%s' "$RESP"
exit 0
