#!/bin/sh
# Old hook path from before the rename. Forwards to the Lookout hook beside this file
# so a checkout that still points here keeps working. `pnpm protect` installs
# hooks/lookout-hook.sh instead, and still removes entries that mention this file.
DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
exec "$DIR/lookout-hook.sh" "$@"
