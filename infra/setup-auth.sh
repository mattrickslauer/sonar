#!/usr/bin/env bash
#
# One-time operator setup for Sonar's DB-native auth (claim your account).
# Run from the repo root. Idempotent where possible — safe to re-run.
#
# Prereqs:
#   - aws CLI authenticated with an identity that has IAM write + DSQL admin
#     (dsql:DbConnectAdmin) on the cluster
#   - vercel CLI logged in (`vercel login`)
#   - `npm install` has been run (provides pg + @aws-sdk/dsql-signer for the
#     migration runner)
#
# Usage:
#   bash infra/setup-auth.sh            # do everything
#   STEP=iam   bash infra/setup-auth.sh # only the IAM grant
#   STEP=sql   bash infra/setup-auth.sh # only the DSQL migrations
#   STEP=env   bash infra/setup-auth.sh # only the Vercel env vars
#   STEP=ses   bash infra/setup-auth.sh # only the SES sender + ses:SendEmail grant
set -euo pipefail

# --- config (edit if your account / cluster / region / project differ) -------
ACCOUNT_ID="${ACCOUNT_ID:-821135790223}"
REGION="${REGION:-us-east-1}"
DSQL_CLUSTER_ID="${DSQL_CLUSTER_ID:-7rt2xophiyumbk2nzjkf5umwhe}"
VERCEL_SCOPE="${VERCEL_SCOPE:-ag-farms}"
VERCEL_PROJECT="${VERCEL_PROJECT:-sonar}"
VERCEL_TARGET="${VERCEL_TARGET:-production}"   # production | preview | development
SES_SENDER="${SES_SENDER:-Sonar <noreply@mysonar.zone>}"
SES_IDENTITY="${SES_IDENTITY:-mysonar.zone}"   # the verified SES identity (domain — lets any @mysonar.zone address send)

CLUSTER_ARN="arn:aws:dsql:${REGION}:${ACCOUNT_ID}:cluster/${DSQL_CLUSTER_ID}"
export SONAR_DSQL_ENDPOINT="${DSQL_CLUSTER_ID}.dsql.${REGION}.on.aws"
export SONAR_REGION="${REGION}"
STEP="${STEP:-all}"

run_iam() {
  echo "==> IAM: grant dsql:DbConnect to the sonar-vercel user (lets the"
  echo "         deployed app open DSQL connections as the sonar_app role)"
  aws iam put-user-policy \
    --user-name sonar-vercel \
    --policy-name SonarDsqlConnect \
    --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Sid\":\"SonarDsqlConnect\",\"Effect\":\"Allow\",\"Action\":\"dsql:DbConnect\",\"Resource\":\"${CLUSTER_ARN}\"}]}"
  echo "    done."
}

run_sql() {
  echo "==> DSQL migrations against ${SONAR_DSQL_ENDPOINT}"
  # 000 creates the sonar_app role + IAM-links it. CREATE ROLE errors if it
  # already exists — that's fine on a re-run (|| true), the grant is already set.
  node infra/sql/run.mjs infra/sql/000_app_role.sql || \
    echo "    (000 reported an error — usually 'role already exists', safe to ignore)"
  # 001 is fully idempotent (IF NOT EXISTS throughout).
  node infra/sql/run.mjs infra/sql/001_accounts_auth.sql
}

set_env() { # name value
  # Replace any existing value so the script is idempotent.
  vercel env rm "$1" "$VERCEL_TARGET" --yes --scope "$VERCEL_SCOPE" >/dev/null 2>&1 || true
  printf '%s' "$2" | vercel env add "$1" "$VERCEL_TARGET" --scope "$VERCEL_SCOPE"
}

run_env() {
  echo "==> Vercel env vars (${VERCEL_TARGET})"
  vercel link --yes --project "$VERCEL_PROJECT" --scope "$VERCEL_SCOPE" >/dev/null
  # NOTE: this (re)generates the session secret, which logs out existing
  # sessions. Comment the next two lines out if you've already set it.
  SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")"
  set_env SONAR_SESSION_SECRET "$SECRET"
  set_env SONAR_DSQL_ENDPOINT  "$SONAR_DSQL_ENDPOINT"
  set_env SONAR_DSQL_USER      "sonar_app"
  set_env SONAR_DSQL_DATABASE  "postgres"
  echo "    done. Redeploy to pick them up:  vercel --prod --scope $VERCEL_SCOPE"
}

run_ses() {
  echo "==> SES: verify the sender identity, grant sonar-vercel ses:SendEmail,"
  echo "         and set SONAR_SES_SENDER=${SES_SENDER}"
  # Create the identity if it doesn't exist yet. An EMAIL_ADDRESS identity then
  # emails a confirmation link you must click; a domain identity needs DNS
  # records. Skips cleanly if already verified.
  aws sesv2 create-email-identity --email-identity "$SES_IDENTITY" --region "$REGION" 2>/dev/null \
    && echo "    created identity ${SES_IDENTITY} — check your inbox and click the verify link" \
    || echo "    identity ${SES_IDENTITY} already exists (skipping create)"
  # SES authorizes ses:SendEmail against BOTH the sender AND recipient identity,
  # and against the account's default configuration set if one is applied — so
  # scope to all identities + configuration sets in this region (NOT just the
  # sender identity, which fails on the recipient / config-set resource).
  aws iam put-user-policy --user-name sonar-vercel --policy-name SonarSesSend \
    --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Sid\":\"SonarSesSend\",\"Effect\":\"Allow\",\"Action\":[\"ses:SendEmail\",\"ses:SendRawEmail\"],\"Resource\":[\"arn:aws:ses:${REGION}:${ACCOUNT_ID}:identity/*\",\"arn:aws:ses:${REGION}:${ACCOUNT_ID}:configuration-set/*\"]}]}"
  vercel link --yes --project "$VERCEL_PROJECT" --scope "$VERCEL_SCOPE" >/dev/null
  set_env SONAR_SES_SENDER "$SES_SENDER"
  echo "    done. NOTE: SES starts in sandbox (recipients must be verified);"
  echo "    request production access in the SES console for arbitrary signups."
}

case "$STEP" in
  iam) run_iam ;;
  sql) run_sql ;;
  env) run_env ;;
  ses) run_ses ;;
  all) run_iam; run_sql; run_env; run_ses ;;
  *)   echo "unknown STEP=$STEP (use iam|sql|env|ses|all)"; exit 1 ;;
esac

cat <<EOF

-- Still manual (only you can provision this) --------------------------------
Google one-tap:   create an OAuth client (Google Cloud Console → Credentials),
authorize your origins (https://mysonar.zone, https://www.mysonar.zone, http://localhost:3000), then:
    vercel env add NEXT_PUBLIC_GOOGLE_CLIENT_ID $VERCEL_TARGET --scope $VERCEL_SCOPE
    # NEXT_PUBLIC_* is build-time — redeploy after setting it.
    # (Google is optional — email-OTP carries the flow without it.)
EOF
