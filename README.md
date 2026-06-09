# Sonar

**The layer where places remember.**

Snapchat is all-ephemeral. Instagram is all-permanent. Sonar is the layer in between — a place has a 24-hour memory you can see, hear, and **ask**, and the crowd decides what's worth keeping forever.

---

## What it is

Open Sonar and you see a live radar of what's happening **around you right now**. People drop ephemeral **waypoints** — a note, photo, video, or 15-second voice clip — onto colored **channels**. Waypoints stream in **live**, are ranked by **proximity + freshness**, and **expire after 24 hours**.

Two things make it more than a social map:

1. **Ask the place** — AI summarizes and answers questions over a location's last 24 hours. *"What's the vibe at the north stage?" · "Where's the shortest food line?"*
2. **Earned permanence** — when a waypoint gets enough love, it's **promoted** out of the ephemeral feed into permanent storage: a place's "greatest hits," browsable at that spot and on home.

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
- ⭐ Crowd-curated permanence — loved waypoints become a place's archive
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
   Transcribe +      │  waypoints (geohash PK · 24h TTL · love)  │
   Bedrock (Claude)  │  channel membership · usage metering      │
                     └────────────────────┬─────────────────────┘
                                          │ Streams → Lambda
                   ┌──────────────────────┼──────────────────────┐
                   ▼                      ▼                       ▼
             live fan-out          promote on love          meter rollup
             to subscribers        (→ DSQL)                 (usage → DSQL)
                                          │                       │
                                          ▼                       ▼
                            ┌────────────────────────────────────────┐
                            │               Aurora DSQL              │
                            │  "greatest hits" · B2B analytics ·     │
                            │  accounts · channels · billing (SoR)   │
                            └─────────────────┬──────────────────────┘
                                              ▼
                                  usage-based billing (Stripe metered)
```

- **DynamoDB** — high-write ephemeral path. Geohash partition keys for geo queries, TTL for automatic 24-hour expiry, atomic counters (love + metering), Streams to drive live fan-out, promotion, and billing rollups. Also holds channel membership and raw usage-metering records.
- **API Gateway (WebSockets) + Lambda authorizer** — real-time delivery. Clients subscribe to channel scopes; the authorizer gates private channels to members. Connect / message / disconnect events are the metered units.
- **Aurora DSQL** — serverless, scale-to-zero, Postgres-compatible relational store doing triple duty: the "greatest hits" archive, the workplace **analytics/BI** dashboard, and the **billing system-of-record** (accounts, channels, subscriptions, invoices).
- **S3 + CloudFront** — all media. Presigned uploads, CDN delivery. (Media never lives in DynamoDB — 400 KB item cap.)
- **Amazon Transcribe + Bedrock (Claude)** — voice → text → "ask the place" summary / Q&A.
- **Stripe** — usage-based metered billing, fed by the DSQL rollups.

> **No vector database.** Geofencing plus a 24-hour window bound every AI query's context small enough to answer in a single model call — the data model does the scaling.

### Core access patterns

| Pattern | Design |
|---|---|
| Drop a waypoint | `PK = CH#<channel>#GEO#<geohash6>`, `SK = WP#<ts>#<id>` |
| What's near me | Query my geohash + 8 neighbors, merge, rank by proximity + freshness |
| Subscribe to a channel | WebSocket `subscribe`; authorizer checks membership for private channels |
| Live update | Streams → Lambda → push to the channel's subscribers in range |
| Auto-expire | `ttl = createdAt + 24h` (DynamoDB) |
| Promote | `UpdateItem ADD love 1`; at threshold → Streams → Lambda copies into Aurora DSQL |
| Browse "greatest hits" | SQL query on DSQL by place / channel / top-loved |
| Ask the place | Query the cell's last 24h → feed to Claude |
| Meter usage | connect/message events → metering items; Streams → atomic rollup → DSQL |

### Region

All resources run in **`us-east-1`** (DynamoDB, Aurora DSQL, API Gateway, Lambda, S3, Transcribe; CloudFront is global) — co-located, and the region where Claude on Bedrock is available on-demand.

---

## Pricing

Sonar is **free to use** — public channels (the live local feed) cost nothing, which keeps the network open and dense.

Revenue comes from **private channels**, billed **purely on usage** — metered on the real-time resources a channel actually consumes:

- **active connection-time** (subscriber connection-minutes), and
- **messages delivered** (waypoints + events fanned out).

You pay only for what your channel uses — there is no flat fee or seat minimum. This mirrors the underlying real-time infrastructure's own economics, so cost scales directly with activity. Typical buyers: festival crews, event organizers running official channels, and building/coworking operators running private per-floor or per-team channels.

## Stack

Next.js (v0) · Vercel · Amazon DynamoDB · Amazon Aurora DSQL · Amazon API Gateway (WebSockets) · AWS Lambda · Amazon S3 · CloudFront · Amazon Transcribe · Amazon Bedrock (Claude) · Stripe (usage-based billing)

## Status

🚧 In active development for the [H0: Hack the Zero Stack](https://h01.devpost.com/) hackathon.
