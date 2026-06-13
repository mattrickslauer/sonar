-- Sonar — least-privilege application role for the Next/Vercel server.
--
-- Run ONCE per DSQL cluster, connected as `admin` (psql to the cluster with the
-- admin IAM token). This creates the non-admin Postgres role the web app logs in
-- as, and links it to the scoped `sonar-vercel` IAM user so it can authenticate
-- with a `dsql:DbConnect` (NOT admin) token.
--
-- Why a dedicated role: the app should never connect as `admin`. `sonar_app`
-- gets only the table privileges it needs (granted in 001_accounts_auth.sql),
-- so a compromised web credential can't touch the rest of the cluster.
--
-- Prereq: the sonar-vercel IAM user must hold `dsql:DbConnect` on this cluster
-- (see the CDK `DsqlUserPolicyJson` output → attach to sonar-vercel).

-- LOGIN role with no password — DSQL authenticates it via IAM, not a secret.
CREATE ROLE sonar_app WITH LOGIN;

-- Bind the Postgres role to the IAM principal. Any identity that can mint a
-- DbConnect token for this ARN may now log in AS sonar_app (and only as it).
-- Replace the account id if you are not on 821135790223.
AWS IAM GRANT sonar_app TO 'arn:aws:iam::821135790223:user/sonar-vercel';

-- Table-level GRANTs to sonar_app live in 001_accounts_auth.sql, applied after
-- the accounts schema migration so the grants reference real tables.
