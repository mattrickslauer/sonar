# Can we ship Sonar for real, right now?

> Judges for H0 repeatedly say they reward **shippable software, not demos**. This is an honest readiness assessment: what's production-grade today, what's hackathon-scoped, and the exact gap to a real go-live. Pair it with [`USE_CASE.md`](./USE_CASE.md).

## Short answer
**Yes — it's already live and serving production traffic at https://mysonar.zone.** Verified: `HTTP 200`, full SEO metadata served, on the real domain behind `www`. The architecture is the kind you'd actually run in production; the remaining gap to a *paid, real-world deployment* is operational hardening, not a rewrite.

## What's genuinely production-grade today
| Area | Status | Evidence |
|---|---|---|
| Frontend deploy | ✅ Live on Vercel, custom domain `mysonar.zone`, Next.js 16 app-router | `curl` → 200; metadata + OG served |
| Primary database | ✅ DynamoDB `sonar`, **on-demand** capacity — scales with traffic, no provisioning | `infra/lib/sonar-stack.ts` |
| Geo + ephemerality | ✅ Geohash partition keys; native **TTL**; likes = atomic `ADD ttl 300` | server waypoint code |
| Relational SoR | ✅ Aurora DSQL, **IAM-native auth** (no passwords), **least-privilege** `sonar_app` role (no DELETE/DDL) | `infra/sql/000_app_role.sql`, `dsql.ts` |
| Real-time | ✅ API Gateway WebSockets + Lambda authorizer (private-channel gate) | `infra/lambda/ws-*` |
| Media | ✅ S3 presigned uploads (private bucket) + CloudFront signed-URL CDN reads; media off the DB hot path | `media.ts`, `sonar-stack.ts` |
| Payments | ✅ Real Stripe integration — subscriptions in DSQL, webhook is a Lambda Function URL, secret in SSM | `billing/*`, `003_subscriptions.sql` |
| Auth | ✅ DB-native (Google one-tap + OTP), JWT sessions, same secret shared with WS authorizer | `auth/*`, `session.ts` |
| Infra as code | ✅ One AWS CDK stack, fully reproducible; tagged `project=aws-hackathon` | `infra/` |
| Cost realism | ✅ ~$24/mo at ~10K MAU / ~500K waypoints/mo; DSQL scale-to-zero saves ~$88/mo vs Aurora Sv2 | INTERNAL_STRATEGY |

## The honest gap to a *real customer* go-live
None of these block a demo or the submission; they're what you'd close before charging a real venue.

1. **CDK removal policy is `DESTROY`** (hackathon convenience). Flip DynamoDB + S3 + DSQL to `RETAIN` and enable point-in-time recovery (PITR) on DynamoDB. *~30 min.*
2. **Stripe is in test mode.** Swap to live keys + live webhook secret in SSM, verify the sponsorship checkout end-to-end. *~1 hr.*
3. **Single region (us-east-1).** Fine for launch (and required for Claude-on-Bedrock on-demand). Multi-region is a *scale*, not *ship*, concern — DynamoDB global tables + DSQL multi-region are the documented path when you need it.
4. **Bedrock model access** must be enabled on the production account (us-east-1). *Console toggle.*
5. **Abuse/safety for a public radar:** rate-limit drops per account, basic content moderation on media, a report/hide path. *The one item that genuinely matters before opening to the public at a real venue — budget ~1 day.*
6. **Observability:** CloudTrail → CloudWatch is wired; add a dashboard for DynamoDB throttles, WS connection count, Lambda errors, and DSQL connection failures before a live event. *~half day.*
7. **Load posture:** on-demand DynamoDB + scale-to-zero DSQL + Lambda + API GW WS means there is **no fixed capacity to exhaust** — the scaling story is the serverless stack itself. Run one synthetic load pass (simulate a few thousand concurrent radars) to validate WS fan-out before a headline event.

## Bottom line for the submission
You can stand in front of a judge and say: *"This is live at mysonar.zone. Provisioning a new environment is one `cdk deploy` plus migrations. There's no server to scale and no idle compute to pay for. The path from here to a paid venue deployment is operational hardening — flip removal policies, go-live Stripe keys, add moderation — not a rebuild."* That is the definition of shippable.

## One-command(ish) fresh deploy (the "ship it" proof)
```bash
cd infra
npm install
npm run deploy          # cdk deploy SonarStack  (DynamoDB, DSQL, S3, WS API, Lambdas)
npm run migrate         # apply infra/sql/*.sql to the new DSQL cluster
# → copy CDK outputs (WsApiEndpoint, MediaBucketName, DsqlEndpoint) into Vercel env, redeploy frontend
```
