#!/usr/bin/env bash
# Start Harness, wait until the dashboard and the event stream answer, then stop it.
set -euo pipefail

cd "$(dirname "$0")/.."

log=$(mktemp)
data=$(mktemp -d)
pid=""

cleanup() {
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    i=0
    while [ "$i" -lt 25 ] && kill -0 "$pid" 2>/dev/null; do
      i=$((i + 1))
      sleep 0.2
    done
    if kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null || true
    fi
    wait "$pid" 2>/dev/null || true
  fi
  rm -rf "$data"
}
trap cleanup EXIT

HARNESS_DATA_DIR="$data" node src/server.js >"$log" 2>&1 &
pid=$!

ready=0
i=0
while [ "$i" -lt 50 ]; do
  if curl -fs -o /dev/null http://127.0.0.1:4100/; then
    ready=1
    break
  fi
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "Harness exited before it opened port 4100."
    cat "$log"
    exit 1
  fi
  i=$((i + 1))
  sleep 0.2
done

if [ "$ready" != 1 ]; then
  echo "Harness did not answer on http://127.0.0.1:4100."
  cat "$log"
  exit 1
fi

page=$(mktemp)
code=$(curl -sS -o "$page" -w "%{http_code}" http://127.0.0.1:4100/)
if [ "$code" != 200 ]; then
  echo "Dashboard returned HTTP $code."
  cat "$page"
  cat "$log"
  exit 1
fi
if ! grep -q "<h1>Harness</h1>" "$page"; then
  echo "Dashboard response was not the Harness page."
  cat "$log"
  exit 1
fi

headers=$(mktemp)
body=$(mktemp)
curl_err=$(mktemp)
# The stream stays open, so curl stops on the time limit after the first comment.
curl -sS -N -D "$headers" --max-time 5 -o "$body" http://127.0.0.1:4100/api/stream 2>"$curl_err" || true
if ! grep -qi "text/event-stream" "$headers"; then
  echo "The event stream was not text/event-stream."
  echo "---- headers ----"
  cat "$headers"
  echo "---- body ----"
  cat "$body"
  echo "---- curl ----"
  cat "$curl_err"
  echo "---- server log ----"
  cat "$log"
  exit 1
fi
if ! grep -q ": connected" "$body"; then
  echo "The event stream did not send the connected comment."
  cat "$body"
  cat "$curl_err"
  cat "$log"
  exit 1
fi

echo "Dashboard and event stream answered on port 4100."
