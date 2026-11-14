#!/bin/sh
# Compatibility entry point for existing Lookout installations.
exec "$(dirname "$0")/harness-hook.sh" "$@"
