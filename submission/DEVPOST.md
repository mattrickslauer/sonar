# Sonar — Devpost submission text

> **Track:** 3 · Million-scale Global App
> **AWS Databases used:** Amazon DynamoDB (primary, high-write ephemeral path) + Amazon Aurora DSQL (relational system-of-record)
> **Live:** https://mysonar.zone · **Tagline:** *The layer where places remember.*

Paste these blocks into the matching Devpost fields. Everything here is true of the deployed app — no vaporware.

---

## Elevator pitch (one line)
A live radar of what's happening around you right now — ephemeral, crowd-curated, and conversational. Built on a deliberately polyglot AWS data layer: DynamoDB for the high-write radar, Aurora DSQL for the relational record.

---

## Inspiration
Every social product forces a single time horizon. Snapchat is **all-ephemeral** — it forgets everything. Instagram is **all-permanent** — nothing ever fades. But a *place* isn't either. A festival stage, a campus quad, a conference floor has a **living, recent memory**: what's happening *now* and over the last day, not forever. We wanted the layer in between — where a place remembers just long enough to be useful, and the crowd decides what's worth keeping.

The deeper bet: this is fundamentally a **database-shaped problem**, not a feature problem. "What's worth going over to, right now, near me?" is a question about a high-write stream of geo-tagged, time-decaying events — and a separate question about durable accounts, money, and analytics. Those are two different data shapes. We chose two different AWS databases on purpose.

## What it does
Open Sonar and you see a **live radar** of your surroundings. People drop **waypoints** — a note, photo, or video — onto colored **channels** (Events, Food, Music, Social, Safety). Waypoints:

- **stream in live** over WebSockets and are ranked by **proximity + freshness**;
- **live as long as you choose** — the author picks a lifespan (default **15 minutes**, up to **24 hours**), and life trades against size: the longer a drop lives, the smaller it may be — a **byte-hour budget** (50 MB at 15m → 3 MB at 24h). Sonar stays ephemeral by design;
- **gain life from likes** — every like adds **+5 minutes** to a drop's countdown, uncapped, so the crowd keeps the good stuff alive minute by minute.

Two things make it more than a map:
1. **Ask the place** — AI summarizes and answers questions over a location's last 24 hours ("What's the vibe at the north stage?" "Where's the shortest food line?").
2. **Likes buy time; sponsors buy permanence** — nothing user-posted lasts forever. The only permanent pins are **sponsored** ones: a paid waypoint that never expires and carries the sponsor's name. Permanence isn't earned by love; it's purchased.

## How we built it — the data model is the product
We deployed a **polyglot, all-serverless AWS data layer**, choosing each database for its access pattern rather than defaulting to one store.

**Amazon DynamoDB — the high-write ephemeral radar (primary database).**
- **Geospatial partition keys.** Items key on `PK = CH#<channel>#GEO#<geohash6>`, `SK = WP#<ts>#<id>`. "What's near me" is a query of my geohash cell + its 8 neighbors, merged and ranked — no scan, no geo extension, single-digit-ms reads at any scale.
- **TTL *is* the business logic.** A drop's expiry is a native DynamoDB TTL attribute — and the **lifespan the author picks sets both the TTL and the upload byte-cap together**, so storage *time* and storage *size* trade off in a single choice (the *byte-hour* model: longer life, lighter payload). "Likes buy time" is literally an atomic `ADD ttl 300` on the item — the like button writes the feature directly into the storage layer. Sponsored pins use a far-future TTL, so "permanence" is the same mechanism dialed to infinity.
- **Streams drive everything reactive.** `NEW_AND_OLD_IMAGES` streams fan out new drops to WebSocket subscribers in range and roll usage events up for billing — the database emits the events; we don't poll.
- **Atomic counters** for likes and metering; **on-demand capacity** so it scales to millions of writes without provisioning.
- One table also holds channel membership, presence, OTP codes, and usage-metering records — single-table design, every access pattern a key lookup.

**Amazon Aurora DSQL — the relational system-of-record.**
Some data is relational and must be correct: **accounts**, **subscriptions / sponsorships**, and **billing/analytics**. We put it in Aurora DSQL — serverless, **scale-to-zero**, Postgres-compatible — doing several deliberate jobs: identity (the canonical `accounts.id` is our userId), Stripe subscription state that gates the permanent-waypoint feature, the sponsorships record, and the usage/analytics rollups. **IAM-native auth** (DSQL Signer, no passwords; tokens rotate ~15 min) and a **least-privilege app role** (`sonar_app`: SELECT/INSERT/UPDATE only, no DELETE/DDL). Choosing DSQL over Aurora Serverless v2 removes ~$88/mo of idle compute because it truly scales to zero — the right tool *and* the right economics.

**The clinching architecture decision:** geofencing + a 24-hour window bound every "ask the place" AI query's context small enough to answer in a **single model call** — so **there is no vector database.** The data model is the scaling strategy.

**The rest of the stack:** Next.js 16 on **Vercel** (mobile-first Mapbox radar UI, server routes, app-router); API Gateway **WebSockets** + a Lambda authorizer for real-time delivery and connection access control; **Amazon S3 + CloudFront** for media (presigned uploads to a private bucket; reads served from the CloudFront edge via short-lived signed URLs, so media stays gated — and never touches DynamoDB's 400 KB item cap); **Amazon Bedrock (Claude Haiku)** for "ask the place" (authenticated with the same IAM identity as the data layer — no separate API key); **Stripe** for sponsorships. All AWS infra is **AWS CDK** (one stack), us-east-1.

## Who it's for & why it matters
Anyone in a **dense, lively, time-sensitive place** — festival-goers, students on a campus, conference attendees, a neighborhood during an event. The question Sonar answers — *"is it worth going over there, right now?"* — is universal and currently unanswered by all-permanent feeds. The same engine runs **Sonar for Work**: a workplace coordination layer for office parks and multi-tenant buildings (see the B2B outline).

## Challenges we ran into
- **Aurora DSQL is new** and has sharp edges we had to design around: it rejects the `statement_timeout` GUC, and demands distinct `$`-placeholders per column type (a `42P08` that broke every write until fixed). Working through these is exactly why using DSQL *competently* is a differentiator.
- **Making TTL carry product meaning** (likes → +5 min) while keeping reads cheap meant getting the single-table key design right up front.
- **Real-time fan-out from Streams** to only the WebSocket connections subscribed to a channel *and* in geo-range, with a Lambda authorizer enforcing connection access control.

## Accomplishments we're proud of
A genuinely **shippable** product, live at mysonar.zone, where the database isn't a checkbox — it's the centerpiece. Two serverless AWS databases, each doing the job it's best at, with the marquee feature (likes-buy-time) implemented *as* a TTL mutation. And a realistic cost model: ~$24/mo at a coherent early-traction scale (~10K MAU, ~500K waypoints/mo).

## What we learned
Pick the database for the access pattern, not the other way around. A high-write, time-decaying, geo-partitioned stream is a textbook DynamoDB workload; durable money and identity want a relational store; DSQL's scale-to-zero makes "use the right tool" affordable even at hackathon scale. And constraints (geofence + 24h window) can replace whole subsystems — they let us delete the vector database.

## What's next
- **Sonar for Work** (B2B): the same engine as an office/building coordination layer with an operator analytics dashboard (Track 2).
- Sponsorship marketplace for venues and organizers; richer "ask the place" with multi-place trends.
- Push notifications for channels you subscribe to; offline-tolerant drops.

---

## Required submission facts (copy verbatim)
- **AWS Database(s):** Amazon **DynamoDB** (primary — geohash-partitioned, TTL-driven ephemeral radar with Streams) and Amazon **Aurora DSQL** (relational system-of-record — accounts, subscriptions/sponsorships, billing & analytics).
- **Frontend deploy:** Vercel — **https://mysonar.zone**
- **Vercel Project Link:** `<paste from Vercel dashboard>`
- **Vercel Team ID:** `<paste from Vercel → Settings → General → Team ID>`
- **Architecture diagram:** `ARCHITECTURE_DIAGRAM.pdf` (repo root); a clean frame can also be exported from `submission/DECK.html`.
- **DB-usage screenshot:** AWS console — DynamoDB `sonar` table + Aurora DSQL cluster (us-east-1). See `submission/SUBMISSION_CHECKLIST.md` for exactly which screenshots to capture.
