# Sonar — Data Model

> The persistence design behind the radar. Two stores, each playing to its strength:
> **DynamoDB** for the high-write, ephemeral, proximity-gated live path, and
> **Aurora DSQL** as the relational system-of-record for the permanent archive, analytics, and billing.

This document is the source of truth for keys, attributes, and access patterns. The IaC
(table + GSIs + TTL + streams) and the Lambda code both derive from it.

---

## Design decisions (settled)

These are the product/architecture choices the schema is built on. Changing one of these is a schema change, not a tweak.

- **One ephemeral table.** Every waypoint is 24h-TTL. There is **no statically-seeded permanent world**.
- **Reactive seeding via bots.** Liveness is generated *on demand, near a real user, when they sign in* — not pre-seeded globally. This is cheaper, always-fresh (no empty-world problem at the 24h boundary), and demos better.
- **"Seeking" = nearby browsing.** There is no quest/target entity. The radar's color-on-approach is pure client-side distance math (`distance()` in `src/lib/geo.ts`) over the precise `lat`/`lng` carried on each item. No schema support required beyond storing coordinates.
- **Geohash precision 6** (`gh6`, ≈ 1.2 km × 0.6 km) for the waypoint partition, matched to the ≈ 1 km radar. "Near me" queries the user's cell plus its 8 neighbors, then filters to the exact radius client-side.
- **Bots are first-class but quarantined.** They write to the same table tagged `actorType=bot`. Stream consumers filter them out so they never promote to the archive, never meter for billing, and never count toward real promotion.
- **Bot love can't fake-promote.** Display love (`love`) and promotion-driving love (`realLove`, human-only) are separate counters.

All resources run in **`us-east-1`**.

---

## DynamoDB — single table `sonar`

- **Billing:** on-demand (PAY_PER_REQUEST).
- **TTL attribute:** `ttl` (epoch **seconds**). Drives 24h expiry for waypoints and bot drops; also expires presence and connection records.
- **Streams:** `NEW_AND_OLD_IMAGES` → Lambda consumers for live fan-out, promotion, and metering rollup.
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
| `actorType` | S | `human` \| `bot` — **stream consumers branch on this** |
| `kind` | S | `text` \| `photo` \| `video` \| `voice` |
| `author` | S | display handle |
| `text` | S | body (≤ a few KB; media never lives here — 400 KB item cap) |
| `lat`, `lng` | N | precise coordinates; client computes exact distance + radar color |
| `gh9` | S | full-precision geohash (debug / future finer queries) |
| `createdAt` | N | epoch ms |
| `ttl` | N | epoch **seconds** = `createdAt/1000 + 86400` |
| `love` | N | display love count (humans **and** bots) |
| `realLove` | N | human-only love; **promotion threshold reads this** |
| `promoted` | BOOL | set once copied to the DSQL archive |
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
| **Love a waypoint** | Conditional `PutItem` of the love edge (`attribute_not_exists`) → on success `UpdateItem ADD love 1` (and `ADD realLove 1` when the lover is human). Double-love is rejected by the condition. |
| **Bot tick** (EventBridge, ≈ every 45s) | Query `PK = PRESENCE` → active cells. For each: count real waypoints in the cell; if below the liveness target, drop templated bot waypoints (`actorType=bot`, staggered `createdAt`); optionally bot-love recent real drops (touches `love` only). |
| **Heartbeat** | Client `PutItem` of the presence record (`ttl` ≈ now + 3 min) on a timer while the radar is open. Stale presence self-expires. |
| **Subscribe (WS)** | Authorizer reads `CH#<channel> / MEMBER#<userId>` for private channels; on success store `CONN#<channel> / CID#<connId>`. |
| **Live fan-out** | Stream (INSERT waypoint) → Lambda → Query `PK = CONN#<channel>` → `postToConnection` for each `connId`. |
| **Promote** | Stream (MODIFY) where `realLove` crosses threshold **and** `actorType=human` → idempotent upsert into DSQL `greatest_hits` (unique on `waypoint_id`); set `promoted=true`. Bot waypoints are skipped. |
| **Meter usage** | connect/message → `USAGE#…` event → Stream → atomic `ADD` rollup → flushed to DSQL `usage_rollups`. Bot-origin events excluded. |
| **Auto-expire** | TTL on `ttl`. Waypoints and bot drops vanish at 24h with no janitor. |

> **Stream consumer rule:** every consumer inspects `actorType`. `bot` items are display-only — they never promote, never meter for billing, never increment `realLove`.

### Notes & deferred concerns

- **Hot partitions.** A dense cell (festival main stage, Times Square) concentrates writes on one PK. Acceptable for the demo; if needed, shard the waypoint PK with a suffix (`…#GEO#<gh6>#<n>`) and fan reads across shards. Same applies to the single `PRESENCE` partition.
- **All-channel nearby** is N per-channel queries merged (N = active channels, currently 5). Fine at this scale; revisit if channels proliferate.
- **Channel set** lives in `src/lib/channels.ts` (`events` `food` `music` `social` `safety`; `safety` is private).

---

## Aurora DSQL — system of record

Serverless, scale-to-zero, Postgres-compatible. Does triple duty: the permanent "greatest hits"
archive, the workplace analytics/BI surface, and the billing system-of-record.

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

greatest_hits (                                        -- the promoted archive
  id                  uuid primary key,
  waypoint_id         text unique not null,            -- idempotency key from the stream
  channel_id          text references channels(id),
  place_label         text,
  lat                 double precision not null,
  lng                 double precision not null,
  geohash             text not null,                   -- indexed for "hits near here"
  author_account_id   uuid references accounts(id),
  kind                text not null,
  text                text,
  media_url           text,
  love_at_promotion   integer not null,
  promoted_at         timestamptz not null default now()
)
-- index greatest_hits (geohash);  -- range scan for nearby; or PostGIS if available

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
  period_start      timestamptz not null,
  period_end        timestamptz not null,
  amount_cents      bigint not null,
  stripe_id         text,
  status            text not null                      -- 'draft' | 'open' | 'paid'
)
```

- **Bot personas** are `accounts` rows with `is_bot=true` — a small reusable pool with stable names/avatars. Their waypoints stay ephemeral in DynamoDB and never reach `greatest_hits`.
- **Open external unknown — geo indexing.** Verify Aurora DSQL's PostGIS / extension support. If PostGIS is available, store geometry and use a GiST index for "greatest hits near here." If not, the `geohash` column + a btree range query mirrors the DynamoDB approach and is sufficient.

---

## Data flow summary

```
client ──drop/love/heartbeat──► DynamoDB (sonar)
                                   │ Streams (NEW_AND_OLD_IMAGES)
              ┌────────────────────┼─────────────────────┐
              ▼                    ▼                      ▼
        live fan-out         promote (human,         meter rollup
        → WS subscribers     realLove ≥ thresh)      → usage_rollups
                                   │                      │
                                   ▼                      ▼
                              DSQL.greatest_hits     DSQL.usage_rollups ──► Stripe

EventBridge (~45s) ──► bot tick ──reads PRESENCE, tops up quiet cells──► DynamoDB
```
