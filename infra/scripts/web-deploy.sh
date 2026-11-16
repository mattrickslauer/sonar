#!/usr/bin/env bash
# Build the Next.js app and deploy it to SonarWebStack (Lambda + CloudFront).
#   infra/scripts/web-deploy.sh <env-file> [cert-arn]
# <env-file> holds the production env; it is read at build time for
# NEXT_PUBLIC_* and passed to the Lambda as runtime env. AWS keys in it are
# ignored: the Lambda runs as its own role (infra/lib/web-stack.ts).
set -euo pipefail
ENV_FILE=$(realpath "$1"); CERT_ARN=${2:-}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT"

set -a; . "$ENV_FILE"; set +a
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
  -c webEnvFile="$ENV_FILE" ${CERT_ARN:+-c certArn="$CERT_ARN"}
