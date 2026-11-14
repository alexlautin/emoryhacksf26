#!/bin/sh
# Seatbelt hook forwarder. Claude Code pipes the hook JSON on stdin; this POSTs it to the
# local Seatbelt server and prints its JSON answer.
# If Seatbelt isn't running, PreToolUse FAILS CLOSED (exit 2 blocks the tool call) unless
# SEATBELT_FAIL_OPEN=1 is set. Other events fail open.
EVENT="$1"
PORT="${SEATBELT_PORT:-4100}"
RESP=$(curl -sS --fail --max-time 110 \
  -H 'Content-Type: application/json' \
  -H "X-Seatbelt-Project: ${CLAUDE_PROJECT_DIR:-}" \
  --data-binary @- "http://127.0.0.1:${PORT}/hooks/${EVENT}" 2>/dev/null)
if [ $? -ne 0 ]; then
  if [ "$EVENT" = "pre-tool" ] && [ "${SEATBELT_FAIL_OPEN:-0}" != "1" ]; then
    echo "Seatbelt isn't running, so this action was blocked to keep you safe. Start it with: pnpm start (in the Seatbelt folder)" >&2
    exit 2
  fi
  exit 0
fi
printf '%s' "$RESP"
exit 0
