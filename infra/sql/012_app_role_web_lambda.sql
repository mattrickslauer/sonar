-- Sonar — move the app's DSQL login to the web Lambda's own role.
--
-- For a cluster set up before the app ran fully on AWS: 000 linked sonar_app
-- to a standalone IAM user whose access keys the app carried. Now the web
-- server (SonarWebStack) authenticates as its execution role, so link that
-- role. Run as `admin` after SonarWebStack is deployed:
--   node infra/sql/run.mjs infra/sql/012_app_role_web_lambda.sql
AWS IAM GRANT sonar_app TO 'arn:aws:iam::821135790223:role/sonar-web-server';

-- Once the site is confirmed working on the role, cut the old user off, then
-- delete that IAM user and its access keys:
--   AWS IAM REVOKE sonar_app FROM '<the old app IAM user ARN>';
