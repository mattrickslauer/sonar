#!/usr/bin/env bash
#
# One-time operator setup for Sonar's DB-native auth (claim your account).
# Run from the repo root. Idempotent where possible — safe to re-run.
#
# Prereqs:
#   - aws CLI authenticated with an identity that has DSQL admin
#     (dsql:DbConnectAdmin) on the cluster
#   - SonarStack + SonarWebStack deployed (the web Lambda's role,
#     sonar-web-server, already holds dsql:DbConnect — granted in CDK)
#   - `npm install` has been run (provides pg + @aws-sdk/dsql-signer for the
#     migration runner)
#
# Usage:
#   bash infra/setup-auth.sh            # migrations + the env checklist
#   STEP=sql bash infra/setup-auth.sh   # only the DSQL migrations
#   STEP=env bash infra/setup-auth.sh   # only print the web env values
set -euo pipefail

# --- config (edit if your account / cluster / region differ) -----------------
REGION="${REGION:-us-east-1}"
DSQL_CLUSTER_ID="${DSQL_CLUSTER_ID:-7rt2xophiyumbk2nzjkf5umwhe}"

export SONAR_DSQL_ENDPOINT="${DSQL_CLUSTER_ID}.dsql.${REGION}.on.aws"
export SONAR_REGION="${REGION}"
STEP="${STEP:-all}"

run_sql() {
  echo "==> DSQL migrations against ${SONAR_DSQL_ENDPOINT}"
  # 000 creates the sonar_app role + IAM-links it to the web Lambda's role.
  # CREATE ROLE errors if it already exists — fine on a re-run (|| true).
  node infra/sql/run.mjs infra/sql/000_app_role.sql || \
    echo "    (000 reported an error — usually 'role already exists', safe to ignore)"
  # 001 is fully idempotent (IF NOT EXISTS throughout).
  node infra/sql/run.mjs infra/sql/001_accounts_auth.sql
}

run_env() {
  # The web server's runtime env lives in the env file passed to
  # infra/scripts/web-deploy.sh (never committed). Generate a session secret
  # ONCE — changing it logs every user out — and keep it in that file and in
  # the deploy environment of SonarStack (the WebSocket authorizer shares it).
  echo "==> Put these in the web env file, then run infra/scripts/web-deploy.sh:"
  echo "    SONAR_SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")   # only if not set yet"
  echo "    SONAR_DSQL_ENDPOINT=${SONAR_DSQL_ENDPOINT}"
  echo "    SONAR_DSQL_USER=sonar_app"
  echo "    SONAR_DSQL_DATABASE=postgres"
}

case "$STEP" in
  sql) run_sql ;;
  env) run_env ;;
  all) run_sql; run_env ;;
  *)   echo "unknown STEP=$STEP (use sql|env|all)"; exit 1 ;;
esac

cat <<EOF

-- Still manual (only you can provision this) --------------------------------
Google one-tap:   create an OAuth client (Google Cloud Console → Credentials),
authorize your origins (https://mysonar.zone, https://www.mysonar.zone, http://localhost:3000),
then add NEXT_PUBLIC_GOOGLE_CLIENT_ID to the web env file and redeploy
(NEXT_PUBLIC_* is read at build time). Google is optional — email-OTP carries
the flow without it.
EOF
