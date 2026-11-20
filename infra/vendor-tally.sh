#!/usr/bin/env bash
# Re-copy tally's JS SDK (not on npm) into the places that use it:
#   src/lib/tally/              browser half (the page's tally.capture/identify/reset)
#   src/lib/server/tally/       server half for the Next routes (signup/signin/purchase)
#   infra/lambda/stripe-webhook server half as .mjs for the prod Stripe webhook
#   ./infra/vendor-tally.sh [path-to-tally-repo]
set -euo pipefail
TALLY="${1:-$HOME/Code/tally}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$TALLY/sdk/js/src"
REV="$(git -C "$TALLY" rev-parse --short HEAD)"
VER="$(node -p "require('$TALLY/sdk/js/package.json').version")"
hdr() { echo "// Vendored from tally sdk/js/src/$1 — @mattrickslauer/tally $VER, tally@$REV. Do not edit here;"
        echo "// re-copy with infra/vendor-tally.sh."; }
copy() { { hdr "$1"; cat "$SRC/$1"; } > "$2"; }

mkdir -p "$ROOT/src/lib/tally" "$ROOT/src/lib/server/tally"
copy index.js    "$ROOT/src/lib/tally/index.js"
copy index.d.ts  "$ROOT/src/lib/tally/index.d.ts"
copy server.js   "$ROOT/src/lib/server/tally/server.js"
copy validate.js "$ROOT/src/lib/server/tally/validate.js"
{ hdr server.d.ts; sed "s#'./index.js'#'../../tally/index.js'#" "$SRC/server.d.ts"; } > "$ROOT/src/lib/server/tally/server.d.ts"

W="$ROOT/infra/lambda/stripe-webhook"
copy validate.js "$W/tally-validate.mjs"
{ hdr server.js; sed "s#from './validate.js'#from './tally-validate.mjs'#" "$SRC/server.js"; } > "$W/tally-server.mjs"
echo "vendored @mattrickslauer/tally $VER (tally@$REV)"
