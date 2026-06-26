# Sonar

[![CI](https://github.com/mattrickslauer/sonar/actions/workflows/ci.yml/badge.svg)](https://github.com/mattrickslauer/sonar/actions/workflows/ci.yml)

**The layer where places remember.**

Snapchat is all-ephemeral. Instagram is all-permanent. Sonar is the layer in between — a place has a living memory you can see, hear, and **ask**. Every drop fades in 24 hours, and every like **buys it more time**. The only permanent pins are **sponsored** ones.

---

## What it is

Open Sonar and you see a live radar of what's happening **around you right now**. People drop ephemeral **waypoints** — a note, photo, video, or 15-second voice clip — onto colored **channels**. Waypoints stream in **live**, are ranked by **proximity + freshness**, and **expire after 24 hours**.

Two things make it more than a social map:

1. **Ask the place** — AI summarizes and answers questions over a location's last 24 hours. *"What's the vibe at the north stage?" · "Where's the shortest food line?"*
2. **Likes buy time; sponsors buy permanence** — every like adds **+5 minutes** to a waypoint's countdown (uncapped), so the crowd keeps the good stuff alive minute by minute. Nothing user-posted lasts forever. The single exception is a **sponsored permanent waypoint** — a paid pin that never expires and carries the sponsor's name. Permanence isn't earned by love; it's purchased by sponsors.

## Two flavors, one engine

- **Sonar** — consumer. Hyperlocal place-memory for dense, lively places. Built-in contexts: 🎪 **Festival** · 🎓 **Campus**.
- **Sonar for Work** — workplace. The same coordination layer for an office park or multi-tenant building (🏢): employees share real-time updates on Facilities / Amenities / Events / Security channels, "ask the building" for a daily ops digest, and operators get an anonymized utilization & congestion dashboard.

## Channels

Every waypoint lives on a **channel** — a real-time, geo-scoped topic you subscribe to. Channels organize the live feed and define how privacy and billing work:

- **Public channels** — free and open. Anyone in range can read and post (Events, Food, Safety, Social…). These keep the network dense.
- **Private channels** — invite-only or organization-owned, with access control enforced at subscribe time. Paid (see [Pricing](#pricing)). For a festival crew, an event organizer's official channel, or a company's internal building channels.

Subscribing opens a real-time scope; new waypoints on that channel are pushed live to every subscriber in range.

## Features

- 📍 Proximity-gated, channel-based waypoint feed (text · photo · video · voice)
- ⚡ **Live updates** over WebSockets — the radar moves in real time
- 🔒 **Public & private channels** with access control
- ⏳ Ephemeral by default — 24-hour TTL
- 🤖 "Ask the place" — AI summary & Q&A over a location's recent activity
- ⏱ **Likes buy time** — every like adds 5 minutes to a drop's countdown (uncapped)
- ◆ **Sponsored permanent waypoints** — paid pins that never expire (the only permanence)
- 💳 Usage-based billing for private channels
- 📱 Mobile-first radar UI

---

## Architecture

```
                  ┌────────────────────────────┐
                  │    Vercel / v0 (Next.js)    │  mobile-first radar UI
                  └───┬────────────────────┬────┘
   drop / ask / post  │                    │  WebSocket — subscribe to channels,
   (REST)             │                    │  receive live pushes
                      ▼                    ▼
            ┌────────────────┐   ┌──────────────────────┐
            │ S3 + CloudFront│   │   API Gateway (WS)   │  private channel
            │   media blobs  │   │  + Lambda authorizer │  → members only
            └────────────────┘   └──────────┬───────────┘
                                             │ connect / message / disconnect
                                             ▼
                     ┌──────────────────────────────────────────┐
   ask the place ───►│                 DynamoDB                  │
   Transcribe +      │ waypoints (geohash PK · TTL +5min/like)   │
   Bedrock (Claude)  │  channel membership · usage metering      │
                     └────────────────────┬─────────────────────┘
                                          │ Streams → Lambda
                          ┌───────────────┴───────────────┐
                          ▼                               ▼
                    live fan-out                     meter rollup
                    to subscribers                   (usage → DSQL)
                                                          │
   sponsored pin (paid) ──────────────┐                  ▼
   permanent DynamoDB item            ▼      ┌────────────────────────┐
   + sponsorship record ───────►  Aurora DSQL │  sponsorships ·        │
                                  (record)    │  B2B analytics ·       │
                                              │  accounts · channels · │
                                              │  billing (SoR)         │
                                              └───────────┬────────────┘
                                                          ▼
                                  sponsorships + private-channel usage
                                         (Stripe billing)
```

- **DynamoDB** — high-write ephemeral path. Geohash partition keys for geo queries, TTL for expiry (24h base, **extended +5 min on every like**; **sponsored pins use a far-future TTL so they never expire**), atomic counters (love + metering), Streams to drive live fan-out and billing rollups. Also holds channel membership and raw usage-metering records. Sponsored permanent waypoints live here too, on their geo cell, so they show on the radar.
- **API Gateway (WebSockets) + Lambda authorizer** — real-time delivery. Clients subscribe to channel scopes; the authorizer gates private channels to members. Connect / message / disconnect events are the metered units.
- **Aurora DSQL** — serverless, scale-to-zero, Postgres-compatible relational store doing triple duty: the **sponsorships** record (who paid for which permanent pin, and for how long), the workplace **analytics/BI** dashboard, and the **billing system-of-record** for both revenue lines (sponsorships + private-channel usage; accounts, channels, invoices).
- **S3 + CloudFront** — all media. Presigned uploads, CDN delivery. (Media never lives in DynamoDB — 400 KB item cap.)
- **Amazon Transcribe + Bedrock (Claude)** — voice → text → "ask the place" summary / Q&A.
- **Stripe** — billing for both lines: **sponsorships** (paid permanent pins) and **private-channel usage** (metered), fed by the DSQL records/rollups.

> **No vector database.** Geofencing plus a 24-hour window bound every AI query's context small enough to answer in a single model call — the data model does the scaling.

### Core access patterns

| Pattern | Design |
|---|---|
| Drop a waypoint | `PK = CH#<channel>#GEO#<geohash6>`, `SK = WP#<ts>#<id>` |
| What's near me | Query my geohash + 8 neighbors, merge, rank by proximity + freshness |
| Subscribe to a channel | WebSocket `subscribe`; authorizer checks membership for private channels |
| Live update | Streams → Lambda → push to the channel's subscribers in range |
| Like (buy time) | `UpdateItem ADD love 1`; human likes also `ADD ttl 300` → **+5 min of life** (uncapped) |
| Auto-expire | `ttl = createdAt + 24h + 5 min × likes` (DynamoDB) |
| Sponsored permanent pin | `PutItem` with `sponsored=true` + a far-future `ttl` (never expires) + sponsor label; write a `sponsorships` record in DSQL for billing |
| Ask the place | Query the cell's last 24h → feed to Claude |
| Meter usage | connect/message events → metering items; Streams → atomic rollup → DSQL |

### Region

All resources run in **`us-east-1`** (DynamoDB, Aurora DSQL, API Gateway, Lambda, S3, Transcribe; CloudFront is global) — co-located, and the region where Claude on Bedrock is available on-demand.

---

## Pricing

Sonar is **free to use** — public channels, the live local feed, and **likes-buy-time** all cost nothing. Anyone can keep a great drop alive just by loving it (each like = +5 minutes); the crowd curates for free. Nothing a user posts is ever permanent. Revenue comes from two lines, both recorded in Aurora DSQL (the billing system-of-record):

**1. Sponsored permanent waypoints.** A sponsor pays to place a **permanent pin** — a waypoint that never expires (regardless of likes) and carries the sponsor's name — on a specific place and channel. It shows on the radar like any other waypoint, marked sponsored. This is the consumer-facing permanence product: brands, venues, and organizers buy a lasting presence in a place, billed per pin / per campaign window. Permanence is a sponsorship, never an earned reward.

**2. Private channels — B2B, usage-based.** Private (invite-only / organization-owned) channels are billed **purely on usage** — metered on the real-time resources a channel actually consumes:

- **active connection-time** (subscriber connection-minutes), and
- **messages delivered** (waypoints + events fanned out).

You pay only for what your channel uses — there is no flat fee or seat minimum. This mirrors the underlying real-time infrastructure's own economics, so cost scales directly with activity. Typical buyers: festival crews, event organizers running official channels, and building/coworking operators running private per-floor or per-team channels.

## Stack

Next.js (v0) · Vercel · Amazon DynamoDB · Amazon Aurora DSQL · Amazon API Gateway (WebSockets) · AWS Lambda · Amazon S3 · CloudFront · Amazon Transcribe · Amazon Bedrock (Claude) · Stripe (sponsorship + usage-based billing)

## Development

**Prerequisites:** Node 20+. (The infra package additionally uses the AWS CDK.)

```bash
# 1. Install + configure
npm install
cp .env.example .env.local   # fill in at least SONAR_SESSION_SECRET (>= 32 chars)

# 2. Run the app
npm run dev                  # http://localhost:3000

# 3. Quality gates (these are what CI runs)
npm run lint                 # eslint
npm run typecheck            # tsc --noEmit
npm test                     # vitest — pure logic, OTP/session crypto, WS authorizer
npm run build                # next build
```

The app runs anonymously with no backend configured; set the `SONAR_*` env vars
(see `.env.example`) to enable accounts, media, and the live feed.

**Infrastructure** (AWS CDK, in `infra/`):

```bash
cd infra
npm ci
npx tsc --noEmit
SONAR_SESSION_SECRET=<same-as-app> npx cdk synth   # required: the WS authorizer
```

CI (`.github/workflows/ci.yml`) runs all of the above on every push and PR.

## Status

🚧 In active development for the [H0: Hack the Zero Stack](https://h01.devpost.com/) hackathon.
