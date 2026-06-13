# Sonar — Data Model

> The persistence design behind the radar. Two stores, each playing to its strength:
> **DynamoDB** for the high-write, ephemeral, proximity-gated live path, and
> **Aurora DSQL** as the relational system-of-record for sponsorships, analytics, and billing.

This document is the source of truth for keys, attributes, and access patterns. The IaC
(table + GSIs + TTL + streams) and the Lambda code both derive from it.

---

## Design decisions (settled)

These are the product/architecture choices the schema is built on. Changing one of these is a schema change, not a tweak.

- **One ephemeral table.** Every user/bot waypoint starts at 24h-TTL. There is **no statically-seeded permanent world** and **no earned permanence**.
- **Likes buy time.** A waypoint's life is its `ttl` — base 24h, **extended +5 min (300 s) on every human like, uncapped**. The crowd keeps good drops alive minute by minute; a drop that stops being liked eventually expires. Likes never make a drop permanent.
- **The only permanence is sponsored.** A **sponsored waypoint** is a paid, permanent pin: a normal DynamoDB waypoint with `sponsored=true`, a `sponsor` label, and a **far-future `ttl`** so DynamoDB TTL never deletes it. It lives on its geo cell like any waypoint, so it shows on the radar. There is no love threshold and no promotion stream — permanence is purchased, not earned. DSQL holds the `sponsorships` billing record (who paid for which pin, for how long).
- **Reactive seeding via bots.** Liveness is generated *on demand, near a real user, when they sign in* — not pre-seeded globally. This is cheaper, always-fresh (no empty-world problem at the 24h boundary), and demos better.
- **"Seeking" = nearby browsing.** There is no quest/target entity. The radar's color-on-approach is pure client-side distance math (`distance()` in `src/lib/geo.ts`) over the precise `lat`/`lng` carried on each item. No schema support required beyond storing coordinates.
- **Geohash precision 6** (`gh6`, ≈ 1.2 km × 0.6 km) for the waypoint partition, matched to the ≈ 1 km radar. "Near me" queries the user's cell plus its 8 neighbors, then filters to the exact radius client-side.
- **Bots are first-class but quarantined.** They write to the same table tagged `actorType=bot`. Stream consumers filter them out so they never extend a drop's life and never meter for billing. Bots are never sponsored.
- **Bot love can't buy time.** Display love (`love`, humans **and** bots) and life-extending love (`realLove`, human-only) are separate counters — **only `realLove` extends `ttl`**, so bots can inflate the visible count but can't keep a drop alive.

All resources run in **`us-east-1`**.

---

## DynamoDB — single table `sonar`

- **Billing:** on-demand (PAY_PER_REQUEST).
- **TTL attribute:** `ttl` (epoch **seconds**). Drives expiry for waypoints and bot drops — starts at `createdAt/1000 + 86400`, **extended +300 s per human like**; also expires presence and connection records. **Sponsored pins set a far-future `ttl`** so they never expire (and the +300 s love bump stays a harmless no-op).
- **Streams:** `NEW_AND_OLD_IMAGES` → Lambda consumers for live fan-out and metering rollup. (No promotion consumer — permanence is sponsored, not stream-driven.)
- **IDs:** `ulid` — sortable by creation time *and* unique, so the sort key alone orders a cell's feed chronologically.

### Item types

| Entity | PK | SK | Notes |
|---|---|---|---|
| **Waypoint** | `CH#<channel>#GEO#<gh6>` | `WP#<ulid>` | the live feed item |
| **Love edge** | `WP#<wpId>` | `LOVE#<userId>` | dedupe: one love per user per waypoint |
| **Presence** | `PRESENCE` | `GEO#<gh6>#USER#<userId>` | heartbeat; tells the bot tick where users are |
| **WS connection** | `CONN#<channel>` | `CID#<connId>` | fan-out target list per channel |
| **Channel membership** | `CH#<channel>` | `MEMBER#<userId>` | read by the WS authorizer for private channels |
| **Usage event** | `USAGE#<channel>#<yyyymmddhh>` | `EVT#<ulid>` | raw connect/message events for hourly rollup |

### Waypoint attributes

| Attribute | Type | Description |
|---|---|---|
| `id` | S | ULID, also embedded in SK |
| `channel` | S | one of `events` `food` `music` `social` `safety` |
| `actorType` | S | `human` \| `bot` \| `sponsor` — **stream consumers branch on this** |
| `kind` | S | `text` \| `photo` \| `video` \| `voice` |
| `author` | S | display handle |
| `text` | S | body (≤ a few KB; media never lives here — 400 KB item cap) |
| `lat`, `lng` | N | precise coordinates; client computes exact distance + radar color |
| `gh9` | S | full-precision geohash (debug / future finer queries) |
| `createdAt` | N | epoch ms |
| `ttl` | N | epoch **seconds** = `createdAt/1000 + 86400 + 300 × realLove` (each human like buys +5 min); **sponsored pins use a far-future sentinel** so they never expire |
| `love` | N | display love count (humans **and** bots) |
| `realLove` | N | human-only love; **each one extends `ttl` by 5 min** |
| `sponsored` | BOOL | a paid permanent pin (never expires). Default false |
| `sponsor` | S | sponsor/brand label shown on the pin (only on sponsored waypoints) |
| `mediaKey` | S | S3 object key for photo/video/voice (presigned on read) |

### GSI1 — reverse lookups

Sparse GSI keyed by `GSI1PK` / `GSI1SK`. Two uses share it:

| Use | GSI1PK | GSI1SK |
|---|---|---|
| "My drops" | `USER#<userId>` | `WP#<ulid>` |
| "Channels I'm in" | `USER#<userId>` | `CHMEMBER#<channel>` |

---

## Access patterns

| Pattern | Operation |
|---|---|
| **What's near me** | For each active channel: Query `PK = CH#<channel>#GEO#<gh6>` for the user's cell **+ 8 neighbor cells**, `SK begins_with WP#`. Merge results, client computes exact distance, ranks by proximity + freshness, colors by distance. |
| **Drop a waypoint** | `PutItem` with `ttl = createdAt/1000 + 86400`. |
| **Love a waypoint (buy time)** | Conditional `PutItem` of the love edge (`attribute_not_exists`) → on success `UpdateItem ADD love 1`; when the lover is **human**, also `ADD realLove 1` and `ADD ttl 300` in the same update → the like **buys the drop 5 more minutes** (uncapped). Bot love touches `love` only. Double-love is rejected by the condition (so each user can buy time once). |
| **Bot tick** (EventBridge, ≈ every 45s) | Query `PK = PRESENCE` → active cells. For each: count real waypoints in the cell; if below the liveness target, drop templated bot waypoints (`actorType=bot`, staggered `createdAt`); optionally bot-love recent real drops (touches `love` only). |
| **Heartbeat** | Client `PutItem` of the presence record (`ttl` ≈ now + 3 min) on a timer while the radar is open. Stale presence self-expires. |
| **Subscribe (WS)** | Authorizer reads `CH#<channel> / MEMBER#<userId>` for private channels; on success store `CONN#<channel> / CID#<connId>`. |
| **Live fan-out** | Stream (INSERT waypoint) → Lambda → Query `PK = CONN#<channel>` → `postToConnection` for each `connId`. |
| **Place a sponsored permanent pin** | `PutItem` a waypoint with `actorType=sponsor`, `sponsored=true`, a `sponsor` label, and a **far-future `ttl`** (never expires). It sits on its `CH#…#GEO#…` cell so the normal nearby query returns it. Then write a `sponsorships` row in DSQL (sponsor account, waypoint_id, campaign window, amount) as the billing record. No stream/promotion involved. |
| **Meter usage** | connect/message → `USAGE#…` event → Stream → atomic `ADD` rollup → flushed to DSQL `usage_rollups`. Bot-origin events excluded. |
| **Auto-expire** | TTL on `ttl`. A drop vanishes when its (like-extended) `ttl` passes — base 24h, +5 min per human like, uncapped. **Sponsored pins use a far-future `ttl`, so they never expire.** No janitor. |

> **Stream consumer rule:** every consumer inspects `actorType`. `bot` items are display-only — they never extend a drop's life, never meter for billing, never increment `realLove`. `sponsor` items are permanent (far-future ttl) and excluded from metering.

### Notes & deferred concerns

- **Hot partitions.** A dense cell (festival main stage, Times Square) concentrates writes on one PK. Acceptable for the demo; if needed, shard the waypoint PK with a suffix (`…#GEO#<gh6>#<n>`) and fan reads across shards. Same applies to the single `PRESENCE` partition.
- **All-channel nearby** is N per-channel queries merged (N = active channels, currently 5). Fine at this scale; revisit if channels proliferate.
- **Channel set** lives in `src/lib/channels.ts` (`events` `food` `music` `social` `safety`; `safety` is private).

---

## Aurora DSQL — system of record

Serverless, scale-to-zero, Postgres-compatible. Does triple duty: the **sponsorships** record
(who paid for which permanent pin, and for how long), the workplace analytics/BI surface, and the
billing system-of-record for **both** revenue lines — sponsorships and B2B private-channel usage.
The sponsored *waypoint itself* lives in DynamoDB (it has to show on the radar); DSQL owns the
relational billing side.

```sql
accounts (
  id                uuid primary key,
  handle            text unique not null,
  display_name      text not null,
  avatar_url        text,
  is_bot            boolean not null default false,   -- bot persona pool
  created_at        timestamptz not null default now()
)

channels (
  id                text primary key,                  -- 'events', 'food', ...
  label             text not null,
  emoji             text,
  color             text,
  is_private        boolean not null default false,
  owner_account_id  uuid references accounts(id),
  created_at        timestamptz not null default now()
)

subscriptions (
  account_id        uuid references accounts(id),
  channel_id        text references channels(id),
  role              text not null,                     -- 'owner' | 'member'
  created_at        timestamptz not null default now(),
  primary key (account_id, channel_id)
)

sponsorships (                                         -- billing record for paid permanent pins
  id                  uuid primary key,
  waypoint_id         text unique not null,            -- the permanent DynamoDB waypoint it pays for
  sponsor_account_id  uuid references accounts(id),
  channel_id          text references channels(id),
  label               text not null,                   -- sponsor/brand name shown on the pin
  lat                 double precision not null,
  lng                 double precision not null,
  geohash             text not null,
  starts_at           timestamptz not null default now(),
  ends_at             timestamptz,                     -- campaign window; null = open-ended
  amount_cents        bigint not null default 0,
  status              text not null default 'active',  -- 'active' | 'expired' | 'canceled'
  created_at          timestamptz not null default now()
)

usage_rollups (                                        -- fed from DynamoDB metering
  channel_id          text references channels(id),
  period_start        timestamptz not null,
  connection_minutes  numeric not null default 0,
  messages_delivered  bigint not null default 0,
  primary key (channel_id, period_start)
)

invoices (
  id                uuid primary key,
  account_id        uuid references accounts(id),
  kind              text not null,                     -- 'sponsorship' (permanent pins) | 'usage' (private channels)
  period_start      timestamptz not null,
  period_end        timestamptz not null,
  amount_cents      bigint not null,
  stripe_id         text,
  status            text not null                      -- 'draft' | 'open' | 'paid'
)
```

- **Bot personas** are `accounts` rows with `is_bot=true` — a small reusable pool with stable names/avatars. Their waypoints stay ephemeral in DynamoDB and are never sponsored.
- **Sponsored pins are served from DynamoDB**, not DSQL — they're regular waypoint items (with a far-future `ttl`) on their geo cell, so the normal nearby query returns them with no extra read path. `sponsorships` is purely the relational billing record; it isn't on the radar read path, so no geo index is needed on it.

---

## Data flow summary

```
client ──drop/heartbeat──► DynamoDB (sonar)        love (human) ──► ADD ttl 300  (buys +5 min, in-place)
                             │ Streams (NEW_AND_OLD_IMAGES)
              ┌──────────────┴───────────────┐
              ▼                              ▼
        live fan-out                   meter rollup
        → WS subscribers               → DSQL.usage_rollups ──┐
                                                              ├─► Stripe
sponsor ──put permanent pin──► DynamoDB (far-future ttl)      │
        └──write billing record──► DSQL.sponsorships ─────────┘
                                   (sponsorship)   (B2B usage)

EventBridge (~45s) ──► bot tick ──reads PRESENCE, tops up quiet cells──► DynamoDB
```
