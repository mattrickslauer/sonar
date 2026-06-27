# Sonar for Work — B2B entry outline (stub)

> A second Devpost entry into **Track 2 · Monetizable B2B App**, ~90% shared code with consumer Sonar. This is a positioning/expansion stub — flesh out into a full `DEVPOST.md` + deck when you decide to run the second entry. Keep the two entries **genuinely distinct** (framing, context, demo, dashboard); judges dislike near-duplicates.

## One-liner
**The coordination layer for a workplace.** A live radar of an office park or multi-tenant building — employees share real-time updates, anyone can "ask the building", and operators get an anonymized utilization & congestion dashboard.

## Why it's a strong B2B play
- **Less-crowded track** than consumer social.
- **Clear revenue model:** per-building / per-seat SaaS + a metered private-channel line + an analytics upsell. Operator pays, not the end user.
- **Daily-driver retention:** used every workday (vs. a festival being episodic).
- **Heavier relational job for DSQL** → strengthens the "right tool for the job" architecture story the judges reward.

## What changes vs. consumer Sonar
| Layer | Consumer Sonar | Sonar for Work |
|---|---|---|
| Context | Festival 🎪 / Campus 🎓 | Office park / building 🏢 |
| Channels | Events, Food, Music, Social, Safety | Facilities, Amenities, Events, Security |
| Who pays | Sponsors (permanent pins) | Operator (per-building SaaS + metered private channels) |
| DSQL's job | Sponsorships + billing SoR | **Heavier:** utilization/congestion **analytics & BI** + billing SoR |
| Marquee screen | The radar | **Operator dashboard** — congestion heat by zone, utilization trends, projected bill |

## Architecture delta (small)
Same engine: DynamoDB hot path (geohash + TTL + Streams), DSQL system-of-record, WS real-time, S3 + CloudFront (signed-URL) media, Bedrock "ask the building". The **only material addition** is the operator analytics pipeline:

> DynamoDB Streams → meter/aggregate Lambda → rollups in **Aurora DSQL** → charts in the operator dashboard.

This gives DSQL 4+ deliberate jobs (accounts · private-channel usage metering · sponsorships/billing · BI analytics) — the strongest "right tool for the job" beat in either entry.

## Monetization (B2B)
Usage-based on the real-time layer: cost-plus on API Gateway WebSocket connection-minutes + messages delivered, so premium private channels literally fund the infrastructure. Show a **live usage meter + projected invoice** in the dashboard.

## Demo beats (distinct from consumer video)
1. Employee drops a "3rd-floor kitchen out of coffee" update on **Facilities**.
2. "Ask the building": *"what's the parking situation this morning?"* → digest.
3. **Operator dashboard**: congestion heat map by zone, utilization trend, live usage meter ticking, projected monthly bill.
4. Architecture: same DynamoDB+DSQL split, with DSQL doing the analytics rollups.

## To-do to ship this entry
- [ ] Build/seed the office context (zones, channels, demo employees).
- [ ] Operator dashboard page (charts off DSQL rollups).
- [ ] Live usage meter + invoice preview.
- [ ] Distinct demo video (beats above).
- [ ] Its own `DEVPOST.md` framed around operator value, not consumer.
- [ ] Confirm Devpost multi-entry rules before submitting both.
