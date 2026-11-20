#!/usr/bin/env bash
# Build the Next.js app and deploy it to SonarWebStack (Lambda + CloudFront).
#   infra/scripts/web-deploy.sh <env-file> [cert-arn]
# <env-file> holds the production env; it is read at build time for
# NEXT_PUBLIC_* and passed to the Lambda as runtime env. AWS keys in it are
# ignored: the Lambda runs as its own role (infra/lib/web-stack.ts).
# Shared secrets come from SSM (us-east-1) unless the env file sets them:
#   RESEND_API_KEY  <- /resend/api-key   (OTP email; unset => codes are logged)
set -euo pipefail
ENV_FILE=$(realpath "$1"); CERT_ARN=${2:-}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT"

set -a; . "$ENV_FILE"; set +a

# Runtime env = the env file + SSM secrets it doesn't already set. Written to a
# private temp file (never committed, removed on exit); a missing parameter
# just leaves that feature off.
RUNTIME_ENV=$(mktemp); chmod 600 "$RUNTIME_ENV"; trap 'rm -f "$RUNTIME_ENV"' EXIT
cp "$ENV_FILE" "$RUNTIME_ENV"; echo >> "$RUNTIME_ENV"
ssm_env() { # <VAR> <ssm-name>
  [ -n "${!1:-}" ] && return 0
  local v
  if v=$(aws ssm get-parameter --region us-east-1 --with-decryption --name "$2" \
      --query Parameter.Value --output text 2>/dev/null) && [ -n "$v" ]; then
    printf '%s=%s\n' "$1" "$v" >> "$RUNTIME_ENV"
  else
    echo "web-deploy: SSM $2 not readable, $1 stays unset" >&2
  fi
}
ssm_env RESEND_API_KEY /resend/api-key

npm run build

B=infra/web-bundle
rm -rf "$B"
cp -r .next/standalone "$B"
mkdir -p "$B/.next"
cp -r .next/static "$B/.next/static"
cp -r public "$B/public"
printf '#!/bin/bash\nHOSTNAME=0.0.0.0 exec node server.js\n' > "$B/run.sh"
chmod +x "$B/run.sh"

cd infra
# --exclusively: never redeploy SonarStack from here (it needs its own context,
# e.g. cfPublicKey); deploy SonarStack first when its exports change.
npx cdk deploy SonarWebStack --exclusively --require-approval never \
  -c webEnvFile="$RUNTIME_ENV" ${CERT_ARN:+-c certArn="$CERT_ARN"}
