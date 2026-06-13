# Sonar — Additions Implementation Plan

Turns `docs/additions-braindump.txt` into concrete, code-grounded steps. The five
braindump lines:

1. view tracking
2. a "my drops" button
3. create tags and completely open this up to infinite use with anonymous users
4. guest session by default; create account if you want (optional) but required to create private channels
5. fix share button and make it SEO reachable

> **Business-model update (2026-06-12) — likes buy time; sponsors buy permanence.**
> The old "earned permanence" model (human `realLove` ≥ threshold → Stream promotes the
> drop into DSQL `greatest_hits`) is **removed entirely** — and so is the interim
> "permanence subscription / greatest-hits" idea. There is **no greatest-hits archive**. Now:
> - **Likes extend a drop's life** — each human like does `ADD ttl 300` (+5 min, uncapped)
>   in the love API, in-place. No promotion threshold. Sustained likes keep a drop alive for
>   free, but **nothing a user posts is ever permanent**.
> - **Permanence is sponsored** — the only permanent pins are **sponsored waypoints**: a
>   paid `PutItem` with `actorType=sponsor`, `sponsored=true`, a `sponsor` label, and a
>   **far-future `ttl`** (never expires). The pin lives in DynamoDB on its geo cell, so it's
>   on the radar with no special read path. DSQL holds a `sponsorships` billing row. This is
>   a revenue line that **coexists** with B2B private-channel usage (item 4C); both feed the
>   DSQL billing SoR.
>
> Wherever this plan says "promote on love" / "promoted" / "greatest hits," it's obsolete —
> there is no archive. The share/SSR work (item 5b) no longer needs a DSQL fallback:
> sponsored pins never expire, so their links never break. See `docs/data-model.md`.

> **Prereq for every code step:** this is a modified Next.js 16.2.7. Before writing
> route handlers / metadata / dynamic-route code, read the bundled guide for that
> API under `node_modules/next/dist/docs/01-app/…` (`generate-metadata.md`,
> `sitemap.md`, `opengraph-image.md`, `route.md`, `dynamic-routes.md`). Heed
> deprecation notices.

## What already exists (so we build with the grain)

- **Single ephemeral DynamoDB table `sonar`** with `ttl` (24h), `NEW_AND_OLD_IMAGES`
  stream, and **GSI1** (`GSI1PK`/`GSI1SK`) already provisioned in
  `infra/lib/sonar-stack.ts:49` — sparse, intended for "my drops" and "channels I'm in".
- **Waypoint write** (`src/lib/server/waypoints.ts:118` `putWaypoint`) already sets
  `GSI1PK = USER#<author>`, `GSI1SK = WP#<ulid>`. So **the index for "my drops"
  already gets populated on every drop** — no schema change needed for item 2.
- **Anonymous identity already exists**: `loadUserId()` in `src/app/page.tsx:32`
  mints `u_xxxx` in `localStorage` (`sonar_uid`) and threads it as both `author`
  (the drop's `GSI1PK`) and `user` (love dedup). This is the seed for items 3 & 4.
- **Love** uses a one-edge-per-user dedup pattern (`WP#<id>` / `LOVE#<user>`,
  `src/lib/server/waypoints.ts:176`). Under the new model a **human** love also does
  `ADD ttl 300` in the same update (each like buys the drop +5 min). **View tracking
  copies the dedup pattern** with a `VIEW#<user>` edge — but views never touch `ttl`.
- **Channels** are a static hardcoded list (`src/lib/channels.ts`) mirrored in three
  places: `ws-connect` `ALL_CHANNELS` (`infra/lambda/ws-connect/index.js:17`), the
  bot tick, and the client. Making channels "infinite" means breaking that hardcode —
  the plan deliberately routes the open-ended taxonomy through **tags** (cheap) and
  scopes user-**created channels** as a larger, account-gated phase.
- **Private channels are declared but unenforced**: `safety` has `private: true`
  in the UI only; `ws-connect` has no authorizer. The data model already specs
  `CH#<channel>` / `MEMBER#<userId>` membership rows for exactly this.
- **Share button is a dead `<button>`** in `src/components/WaypointSheet.tsx:106`.
- **Sponsored permanent waypoints** live in DynamoDB with a far-future `ttl`, so they
  never expire and are always returned by the normal channel+geo nearby query. There is
  **no DSQL `greatest_hits` archive** anymore — `sponsorships` in DSQL is just the billing
  record. Relevant to item 5: a sponsored pin's share link never breaks (no fallback needed).

## Store assignment — deliberate polyglot (read this first)

Per `INTERNAL_STRATEGY.md`: the judges are all AWS Databases, **Aurora DSQL is their
flagship**, and the whole thesis is "right tool for the job" across DynamoDB + DSQL.
Every addition is assigned to the store that's *actually* the right tool — which is
also the winning narrative. Do **not** collapse to one store.

| Addition | Store | Rationale |
|---|---|---|
| View tracking (1) | **DynamoDB** atomic counter (+ optional **DSQL** rollup for B2B analytics) | high-write ephemeral hot path; analytics is DSQL's job |
| My **drops** — live (2) | **DynamoDB** GSI1 | ephemeral, proximity/recency |
| Sponsored permanent pins | **DynamoDB** waypoint (far-future ttl) + **DSQL** `sponsorships` | permanent item on the hot path; relational billing in DSQL |
| Tags (3a) | **DynamoDB** waypoint metadata | hot path, additive |
| User-created channels (3b) | **DSQL** `channels` (SoR) + Dynamo read-cache | relational ownership/privacy |
| Optional account (4B) | **DSQL** `accounts` | unique handle, FKs, billing SoR |
| Private-channel membership (4C) | **DSQL** `subscriptions` (SoR) + Dynamo `MEMBER#` mirror | relational SoR; Dynamo mirror = fast WS-authorizer read |
| Share permanent link (5b) | **DynamoDB** sponsored pin (never expires) | permanent links never break — no archive/fallback needed |

This needs a server-side DSQL client (`src/lib/server/dsql.ts`, `@aws-sdk/dsql-signer`
+ `pg`) — see Cross-cutting. That wiring is the work the judges reward.

## Recommended sequencing

Identity (item 4 Phase A) is the foundation — it gives every later feature a stable
guest handle to key on. Then items 2 and 1 are small and independent. Tags (item 3)
and Share/SEO (item 5) are independent. Account + private-channel enforcement (item 4
Phases B/C) is the heaviest and should come last / be scope-gated for the hackathon.

```
A. Guest identity (4A) ──┬──► 1. View tracking
                         ├──► 2. My drops
                         ├──► 3. Tags  ──► 3b. User-created channels (optional)
                         └──► 4B. Optional account ──► 4C. Private-channel enforcement
5. Share + SEO  (independent; benefits from a stable id→lookup)
```

---

## Item 4 — Phase A: Explicit guest session (do first)

**Goal:** make the de-facto anon id a first-class, human-readable guest identity that
every feature shares. No account, no backend yet.

1. **New `src/lib/identity.ts`.** Move/extend `loadUserId()` here. Export:
   - `getIdentity(): { userId: string; handle: string; isGuest: boolean }`.
   - `userId` keeps the existing `u_xxxx` (stable; loves/drops/views key on it — do
     **not** regenerate or old drops detach from "my drops").
   - `handle` = generated friendly name (e.g. `guest-otter-4821`) persisted under
     `sonar_handle`. Replaces the literal `"you"`/`author: userId` so drops show a
     readable author. Keep `userId` as the GSI key; pass `handle` only as display
     `author`? **Decision needed** (see Open questions) — current code keys the
     `USER#` index on `author`, so if we want both, store `userId` in the item and
     set `GSI1PK = USER#<userId>` explicitly rather than `USER#<author>`.
2. **Refactor `src/lib/server/waypoints.ts:131`** so `GSI1PK` keys on a `userId`
   field, decoupled from the display `author`. Add `userId` to `DropInput`, the
   item, and `Waypoint`. This unblocks item 2 keying on a stable id while showing a
   pretty handle.
3. **Wire `src/app/page.tsx`** to load identity once and pass `userId` + `handle`
   into `postDrop`, `postLove`, `postPresence`. Replace the `userId === "you"`
   sentinel guard (line 96) with an `isReady` flag.
4. (Optional) small "you are @handle (guest)" affordance in `TopBar` with a tap → a
   future account sheet (item 4B).

**Acceptance:** drops show a friendly handle; reload keeps the same identity; loves
still dedup; nothing requires sign-in.

---

## Item 1 — View tracking

**Goal:** count how many people opened each waypoint; show it in the sheet.

Mirror the love edge so re-opens by the same person don't inflate the count.

1. **Schema (additive, no migration):** add `views` (N, default 0) to the waypoint
   item in `putWaypoint` (`src/lib/server/waypoints.ts:128`). View dedup edge:
   `PK = WP#<id>`, `SK = VIEW#<userId>`, with `ttl` like the love edge.
2. **Server `src/lib/server/waypoints.ts`:** add `recordView({ id, channel, lat, lng, user })`:
   conditional `PutItem` of the `VIEW#` edge (`attribute_not_exists`) → on success
   `UpdateItem ADD views :one` and return the new count; on
   `ConditionalCheckFailedException` return current `views` with `counted:false`.
   (Direct copy of `loveWaypoint`, minus `realLove` and the `ADD ttl 300` extension —
   **views never buy time and never make a drop permanent**.)
3. **API `src/app/api/view/route.ts`:** `POST { id, channel, lat, lng, user }` →
   `recordView`. `export const dynamic = "force-dynamic"`. Reuse the `parseLove`-style
   validator.
4. **Client `src/lib/waypoints.ts`:** add `views` to `Waypoint`, `toWaypoint`,
   `rawToWaypoint` (and `RawWaypoint`), and a `postView(args)` fetch helper.
5. **`src/app/page.tsx`:** fire `postView` **once per id per session** when a
   waypoint is selected — track sent ids in a `useRef<Set>` (same approach as
   `checkedLovesRef`), and optimistically bump `views`. Guard: don't count the
   author viewing their own drop (compare `wp.author`/`userId`).
6. **`src/components/WaypointSheet.tsx`:** render `👁 {wp.views}` next to the
   age/distance line (line ~52).

**Edge cases:** bot-authored waypoints — viewing them is fine to count (display-only
metric, never meters, never buys time, never makes a drop permanent). Optimistic insert (`drop_*` id) has no server row yet;
skip `postView` until the id is the saved one.

**Acceptance:** opening a drop increments its view count once per person; reopening
does not; the count survives a reload (read back from the item via `queryNearby`).

---

## Item 2 — "My drops" button

**Goal:** a button that lists the current user's own drops; tapping one focuses it on
the radar.

The index is already populated (`GSI1PK = USER#<userId>`). We only add a read path + UI.

1. **Server `src/lib/server/waypoints.ts`:** add `queryMyDrops(userId, center)`:
   `QueryCommand` on `IndexName: "GSI1"`, `KeyConditionExpression: "GSI1PK = :u AND begins_with(GSI1SK, :wp)"`,
   `:u = USER#<userId>`, `:wp = WP#`. Map rows through `toWaypoint(it, center, now)`
   (reuse), drop any past `expiresAt` (TTL can lag deletes), sort newest-first by `id`
   (ULID is time-sortable).
2. **API `src/app/api/my-drops/route.ts`:** `GET ?user=&lat=&lng=` →
   `queryMyDrops`. `force-dynamic`.
3. **Client `src/lib/waypoints.ts`:** `fetchMyDrops(user, center)` helper.
4. **UI `src/components/MyDropsSheet.tsx`:** a bottom sheet (reuse the
   `animate-sheet` shell from `WaypointSheet`) listing each drop: channel chip, text
   snippet, age, `love`/`views`, expires-in. Row tap → `onFocus(wp)`.
5. **`src/app/page.tsx`:** add a "My drops" control to the bottom stack (next to the
   recenter `◎` button at line ~259) opening the sheet. On focus: `setSelectedId(wp.id)`
   + recenter to `wp.pos`. If the focused drop isn't in `waypoints` (loaded out of the
   nearby set), merge it in.

**Edge cases:** empty state ("No drops yet — tap + to drop one"); a drop made far away
won't appear in `queryNearby` but **will** appear here (that's the point — it's the
user's history, not proximity-gated).

**Acceptance:** after dropping, "My drops" lists it; tapping recenters/opens it; it
persists across reloads until TTL.

---

## Item 3 — Tags + open to infinite anonymous use

Split into the cheap, high-value part (tags) and the heavy, optional part
(user-created channels). **The braindump's "infinite use" is satisfied primarily by
tags**, which add an open-ended taxonomy without touching fan-out/bots/WS.

### 3a. Tags (recommended, low risk)

1. **Schema (additive):** `tags` (DynamoDB String Set or `S` list) on the waypoint.
   Keep it client-filterable within the nearby result set — **no new partition/GSI**.
2. **`putWaypoint` + `DropInput`:** accept `tags?: string[]`; normalize
   (lowercase, trim, strip `#`, dedupe, cap length & count e.g. ≤5 tags / ≤24 chars).
   Persist; thread through `toWaypoint`/`rawToWaypoint`/`RawWaypoint` and `Waypoint`.
3. **`src/components/DropComposer.tsx`:** a tag input (chip-style add on Enter/space)
   below the textarea (~line 82). Pass `tags` up through `onDrop` →
   `postDrop`.
4. **`src/components/WaypointSheet.tsx`:** render tags as tappable `#chips`.
5. **Browse/filter by tag:** add a tag filter to `src/app/page.tsx` — a derived set of
   active tags applied in `visibleWaypoints` (client-side `.filter`), surfaced as a
   thin tag bar (reuse `ChannelDock` styling) populated from the tags present in the
   current nearby set. Tapping a tag chip in the sheet sets that filter.
6. (Optional) `AskBar` can match tags too.

**Acceptance:** a guest can add `#tacos` to a drop and filter the radar to `#tacos`
with no account and no new channel.

### 3b. User-created channels (optional, larger — needed by item 4's "create private channels")

Channels are hardcoded in three places. To make them open-ended:

1. **Channel registry becomes data (DSQL = SoR):** the `channels` table already exists
   (`is_private`, `owner_account_id`, label/emoji/color) — make it the source of truth
   and seed the 5 core channels there. Optionally mirror a lightweight registry into
   DynamoDB (`PK = CHREG`) as a hot read-cache for the client/WS, but DSQL owns
   creation, ownership, and privacy (relational FK to `accounts`).
2. **Client loads channels** from `GET /api/channels` instead of the static array;
   keep `src/lib/channels.ts` as types + the core fallback so the app still renders if
   the fetch fails.
3. **Relax `ws-connect`** (`infra/lambda/ws-connect/index.js:28`): stop filtering
   against a fixed `ALL_CHANNELS`; accept any well-formed channel id (regex-validated).
   Bot tick keeps topping up only the core channels (user channels simply have no bots
   — acceptable).
4. **Create-channel flow:** a sheet to name/emoji/color a channel. **Public** channels
   can be created by guests; **private** channels require an account (item 4C) and
   write `ownerUserId` + a membership row.

> **Scope call:** for a hackathon, ship **3a (tags)** and treat **3b** as a stretch.
> Tags deliver "infinite, anonymous, open" immediately; dynamic channels are mostly
> plumbing across three services.

---

## Item 4 — Phases B & C: optional account + private channels

Phase A (guest identity) is above. The braindump: account is **optional**, but
**required to create private channels** (and, by extension, to join/read them).

### 4B. Optional account (lightweight)

Goal: a guest can "claim" a persistent identity. Keep it minimal — no heavy auth vendor.

1. **Store (DSQL — this is the strategic flex):** the `accounts` table (schema exists:
   `handle unique`, `display_name`, `is_bot`). Relational is the *right tool* here —
   unique-handle constraint, FK from `subscriptions`/`sponsorships`, and it's the
   billing system-of-record. This is exactly the "3 deliberate jobs for DSQL" beat the
   judges reward. Requires wiring a DSQL client into the Next server (see Cross-cutting).
   Guest `userId` (`u_xxxx`) is stored on the account row so prior Dynamo drops/loves
   carry over.
2. **Session:** issue an httpOnly, signed cookie (`sonar_session`) carrying
   `{ userId, handle, accountId }`. Needed because the WS authorizer (4C) must verify
   the user server-side, and WS upgrade can't send custom headers from the browser —
   the cookie (same-site) or a short-lived token passed as a WS query param is how we
   carry auth onto the socket.
3. **API:** `POST /api/account` `{ handle, secret }` → create/claim (collision-check
   the unique handle) → set cookie. `GET /api/account` → current session.
   `POST /api/account/session` for returning users (handle + secret).
4. **UI:** an `AccountSheet` reachable from the TopBar guest chip: "Continue as guest"
   (default) vs "Claim a handle". On success, merge the guest's existing `userId` so
   prior drops/loves carry over (write the account's id alongside, keep `userId`
   stable as the GSI key).

> Keep "secret" simple for the demo (a passphrase, or even device-token-only with no
> password). Email magic links / OAuth are out of scope unless asked.

### 4C. Private-channel enforcement (membership + WS authorizer)

Today nothing stops a guest from subscribing to `safety`. To actually gate private
channels:

1. **Membership (DSQL SoR + Dynamo hot mirror):** `subscriptions` in DSQL is the
   system-of-record (account_id × channel_id × role) — relational, joins to accounts
   and channels. Mirror each membership into DynamoDB as `CH#<channel>` / `MEMBER#<userId>`
   (and GSI1 `USER#<userId>` / `CHMEMBER#<channel>`) so the WS authorizer gets a
   single-digit-ms membership check without hitting DSQL on every socket connect. Write
   both when an account joins/creates a private channel (DSQL first, then mirror).
2. **WS authorizer (infra):** add an API Gateway **Lambda authorizer** on the
   WebSocket `$connect` route (new lambda + CDK wiring in `infra/lib/sonar-stack.ts`).
   It reads the session token (WS query param), resolves `userId`, and for each
   **private** channel in `?channels=` checks a `MEMBER#` row exists. Reject the
   connect if any requested private channel is unauthorized (or filter them out).
   `ws-connect` then only records authorized channels.
3. **REST guard:** `queryNearby`/`/api/waypoints` should also refuse private channels
   for non-members (the radar GET is the other read path) — check session + membership
   server-side before including a private channel's cells.
4. **Channel creation gating:** `POST /api/channels` with `isPrivate:true` requires a
   session (account); writes the channel registry row + owner membership. Guests get a
   401 with a "claim a handle to create private channels" prompt.
5. **UI gating:** in `ChannelDock`/`DropComposer`, render private channels the guest
   isn't a member of as **locked**; tapping opens the AccountSheet / a join flow.

> **Scope call:** 4C touches infra (new authorizer lambda) and is the riskiest item to
> demo. Minimum viable version: enforce private channels at the **REST + create**
> layer (Next server checks the session cookie) and lock them in the UI, and defer the
> WS authorizer if the live socket isn't part of the private-channel demo path. Note
> clearly in the demo what's enforced where.

---

### 4D. Private invites + invite links (the scope cliff — tier this)

Private channels are only useful if you can let people *in*. That means invite links,
and an invite link to a private channel forces signup. This is the heaviest corner of
the plan — but it mostly **composes** 4B (accounts) + 4C (membership/authorizer) +
item 5 (SSR deep-link), with one genuinely new piece: the invite token.

**The flow:**
1. Owner (account holder) creates a private channel (3b/4C) → "Copy invite link".
2. Create-invite endpoint mints a token row and returns `/join/<token>`.
3. Recipient opens `/join/<token>` (SSR page — reuses item 5 machinery): shows the
   channel name + who invited them + "Sign up to join". A guest **must** create an
   account here (4B) — this is the one place signup is mandatory.
4. Redeem: on signup (or if already signed in), insert a `subscriptions` row
   (DSQL SoR) + the Dynamo `MEMBER#` mirror (4C) → redirect to the radar with that
   private channel unlocked and the WS authorizer now passing.

**New piece — one DSQL table (a *fourth* relational job for DSQL → more "right tool"
credibility):**

```sql
channel_invites (
  token             text primary key,          -- random url-safe id
  channel_id        text references channels(id),
  created_by        uuid references accounts(id),
  expires_at        timestamptz,
  max_uses          integer not null default 1,
  use_count         integer not null default 0,
  created_at        timestamptz not null default now()
)
```

- `POST /api/channels/:id/invite` (owner-only, account-gated) → insert token, return link.
- `GET /join/:token` (SSR) → resolve token → channel preview + signup/redeem CTA.
- `POST /api/invites/:token/redeem` (requires session) → validate (not expired,
  `use_count < max_uses`), `INSERT … subscriptions`, bump `use_count`, mirror `MEMBER#`.

**Edge cases:** expired / used-up / revoked token; already a member (idempotent redeem);
invite to a deleted channel; guest abandons signup mid-redeem (token stays unused).

**Tiered scope — pick one (see decision at end):**

- **v0 — fake the ceremony (~½ day):** no token table. Owner "adds @handle" directly →
  writes `subscriptions` + `MEMBER#`. Demo with two pre-seeded accounts. Still shows the
  full membership + authorizer architecture; skips invite links entirely.
- **v1 — real invite links, minimal (recommended, ~2–3 days):** the `channel_invites`
  table + create/redeem + `/join/:token` SSR + mandatory signup. Single-use or
  time-boxed links. **Cut:** revocation UI, multi-use analytics, roles, email
  verification (handle + passphrase only).
- **v2 — full (post-deadline):** revocation, member management UI, role grants,
  multi-use links with usage counts, email/OAuth.

> **Recommendation:** v1 for entry ② (B2B), because private channels are the
> "Monetizable" beat and the invite→signup→membership→metered-channel path is a clean
> architecture story for DB judges. v0 is the safe fallback if the calendar tightens —
> it still demonstrates the authorizer + relational membership without the invite-link
> surface. Either way, keep signup minimal ("build the meter, fake the checkout"
> applied to auth).

---

## Item 5 — Fix share button + SEO reachability

Two parts: (a) make the button actually share, (b) make shared links crawlable /
unfurlable via server-rendered per-waypoint pages.

### 5a. Functional share

1. **Stable share URL.** A waypoint can only be located by `id` if we also carry where
   it lives (PK = `CH#<channel>#GEO#<gh6>`; love/view APIs already require
   `{id, channel, lat, lng}`). So the canonical URL is
   `/{w}/{id}?c=<channel>&lat=<lat>&lng=<lng>`. (Sponsored pins never expire, so their
   links are durable; ordinary drops 404 to an "expired" page once their ttl passes.)
2. **`src/components/WaypointSheet.tsx:106`:** replace the dead button with an
   `onShare(wp)` handler: build the URL, try `navigator.share({ title, text, url })`,
   fall back to `navigator.clipboard.writeText(url)` + a "Copied" toast.

### 5b. SEO-reachable per-waypoint page (server-rendered)

1. **New route `src/app/w/[id]/page.tsx`** (server component — read
   `node_modules/next/dist/docs/01-app/.../dynamic-routes.md` and
   `generate-metadata.md` first):
   - Read `id` param + `c/lat/lng` searchParams.
   - **Server fetch:** add `getWaypointById(id, channel, lat, lng)` in
     `src/lib/server/waypoints.ts` (derive `gh6` from lat/lng, `QueryCommand`
     `PK = CH#<channel>#GEO#<gh6>` `SK = WP#<id>`).
   - **Permanence is sponsorship, not an archive.** Sponsored pins keep a far-future `ttl`,
     so they're always present in DynamoDB — the same `getWaypointById` query returns them
     and their links unfurl indefinitely. No DSQL fallback / `greatest_hits` lookup. Ordinary
     drops that have expired degrade to a crawlable "this drop expired" page.
   - Render a minimal readable card (channel, author/handle, text, place, love/views)
     + a prominent CTA linking to `/` recentered on the drop (e.g. `/?wp=<id>&lat=&lng=`).
2. **`export async function generateMetadata(...)`** on that page: title from the
   drop text, description, and OpenGraph/Twitter tags so links unfurl in
   iMessage/Slack/X. Add `metadataBase` to `src/app/layout.tsx` metadata.
3. **OG image:** add `src/app/w/[id]/opengraph-image.tsx` (per `opengraph-image.md`)
   rendering a branded card (channel color, text snippet). Start with a static default
   OG image in `app/` if dynamic is over-scope.
4. **Crawlability:** `src/app/sitemap.ts` (per `sitemap.md`) listing **sponsored permanent
   pin** URLs (they never expire, so they're the only ones worth indexing — ephemeral drops
   aren't). Add `src/app/robots.ts`. Set `metadataBase` from `NEXT_PUBLIC_SITE_URL`.
5. **Deep-link open:** `src/app/page.tsx` reads `?wp=&lat=&lng=` on mount, recenters,
   fetches, and opens that waypoint's sheet — so a shared link lands the recipient on
   the live radar focused on the drop.

**Acceptance:** Share copies/opens a real URL; pasting it in Slack/iMessage unfurls
with title+description+image; the page is server-rendered (curl shows the content +
OG tags); a sponsored pin's link unfurls indefinitely (it never expires); an ordinary
expired drop's link renders a crawlable "expired" page.

---

## Cross-cutting / infra checklist

- **No table migration needed** for items 1–3a (all additive attributes; `views`,
  `tags`, `VIEW#` edges). GSI1 already exists for item 2.
- **`RawWaypoint` + fanout:** if `views`/`tags` should appear on live-pushed
  waypoints, the fanout lambda (`infra/lambda/fanout/index.js`) must include them in
  the pushed payload — otherwise they only appear after a `queryNearby` refresh.
  Check and extend the projected fields.
- **Deliberate polyglot — DSQL is a centerpiece, not a liability.** Per
  `INTERNAL_STRATEGY.md`: every judge is AWS Databases, DSQL is their flagship, and the
  winning thesis is "right tool for the job" across DynamoDB + DSQL. **Do not** collapse
  to one store. Hot, ephemeral, high-write paths (radar, drops, loves, views, presence,
  my-drops, **sponsored permanent pins**) → **DynamoDB**. Relational system-of-record
  (accounts, channels, subscriptions, sponsorships, usage/analytics) → **DSQL**. See the
  store-assignment table at the top of this plan.
- **Wire a DSQL client into the Next server.** `src/` currently only uses
  `@aws-sdk/lib-dynamodb`. The DSQL paths (accounts 4B, channels 3b, private membership
  4C, sponsorships billing) need a server-side Postgres client authed with a short-lived
  IAM token via `@aws-sdk/dsql-signer` + `pg`, using the same `SONAR_AWS_*` creds /
  `us-east-1` region the Dynamo client uses. Copy the pattern from
  `infra/lambda/layers/dsql` (the lambdas already reach DSQL). Add a
  `src/lib/server/dsql.ts` connection helper (pool + token refresh). Reads like the
  channel list should be cached.
- **"My drops" query is DynamoDB-aligned:** GSI1 exists with `projectionType=ALL`
  (`infra/lib/sonar-stack.ts:53`), so the single GSI1 query returns full waypoints —
  no follow-up `BatchGet`. Key on the stable `userId` (not the display handle) so the
  `USER#` partition matches what `putWaypoint` writes.
- **New infra (item 4C only):** WS Lambda authorizer + CDK wiring; tag everything
  `project=aws-hackathon`, role-based construct IDs (per infra conventions).
- **Validation:** reuse the `parseLove` pattern for the new `/api/view`,
  `/api/my-drops`, `/api/account`, `/api/channels` routes.
- **Build:** `npm run build` (Next 16.2.7) + `npm run lint` after each phase. `infra/`
  is excluded from the Next TS build.

## Locked decisions (committed — go-all-out, tight & impactful)

All resolved as of 2026-06-10. ~20 days to Jun 29; we have the engine, we commit to the
ambitious-but-disciplined path.

1. **Identity:** decouple — `userId` (`u_xxxx`) stays the GSI key; add a friendly
   `handle` for display. `GSI1PK = USER#<userId>`, no longer keyed on `author`. ✅
2. **Infinite use:** **tags (3a) for both entries** now; **user-created channels (3b)**
   ship as part of the B2B private-channel work, not a separate consumer feature. ✅
3. **Account backend:** **DSQL `accounts`**. Secret = passphrase + hash (simple, no
   email/OAuth). Requires `src/lib/server/dsql.ts`. ✅
4. **Private enforcement:** **full WS Lambda authorizer** (it's the strongest DB-judge
   beat — go all out) + REST guard + UI lock. ✅
5. **Share permanence:** **sponsored pins** (DynamoDB, far-future ttl) make share links
   durable with no DSQL fallback; ordinary expired drops → crawlable "expired" page. ✅
6. **Invite tier:** **v1** (real invite links + mandatory signup, single-use/time-boxed;
   no revocation/roles/email). v0 is the only fallback if the calendar slips. ✅

## 20-day roadmap (Jun 10 → Jun 29, 2026)

Tight, sequenced, with buffer for **two** demo videos + ×2 submission. Entry ① (consumer)
is shippable at the end of Phase 2; Phase 3–4 differentiate entry ② (B2B).

| Window | Phase | Ships | Entry |
|---|---|---|---|
| **Jun 10–12** (d1–3) | 1 · Dynamo hot-path quartet | PR1 identity · PR2 views · PR3 my-drops · PR4 tags | ①+② |
| **Jun 13–16** (d4–7) | 2 · First DSQL on app path | PR5 share+SSR · PR6 DSQL accounts | ①+② |
| **Jun 17–21** (d8–12) | 3 · Private channels | PR7 channels+membership+WS authorizer · PR8 invites (v1) | ② |
| **Jun 22–25** (d13–16) | 4 · Monetizable (B2B) | metering pipeline · live usage meter · invoice preview dashboard | ② |
| **Jun 26–28** (d17–19) | 5 · Polish & package | per-context seed data (festival/campus/office) · distinct framings · arch diagram · storage screenshots | ①+② |
| **Jun 29** (d20) | 6 · Submit | record 2 <3-min videos · submit ×2 on Devpost | ①+② |

> **Buffer rule:** Phase 1 is cheap and de-risks momentum — if anything slips, it slips
> *within* Phase 3–4, never into Phase 5–6. Entry ① must be demo-complete by Jun 16 so
> there's always at least one submittable entry. Don't let B2B scope eat the deadline.

## Hackathon-first prioritization

Ordered by **demo value to AWS Database judges per unit of build effort**, not by code
dependency. The north star (`INTERNAL_STRATEGY.md`): the database is the centerpiece,
DSQL competence = credibility, deadline **Jun 29, 2026**. Build the architecture story;
fake the ceremony.

| Tier | Ships | Why it earns hackathon points |
|---|---|---|
| **Must (core demo)** | PR1 identity · PR2 views · PR3 my-drops · PR4 tags | Cheap, all on the **DynamoDB hot path** — GSI1, atomic counters, TTL, additive attrs. Shows the ephemeral engine working. Low risk. |
| **High (the polyglot beat)** | PR5 share + SSR · PR6 DSQL accounts | Sponsored pins make share links durable (no archive needed); PR6 is the first **DSQL-on-the-app-path** win (relational accounts + the `sponsorships` billing record). The "right tool for the job" story the judges reward, and it makes the app shareable → reach. |
| **B2B / Monetizable (entry ②)** | PR7 channels+membership+authorizer · PR8 invites (v1) · metering meter | Private channels + invite→signup→membership→**metered** path = the "Monetizable" beat. DSQL now has its 3–4 deliberate jobs. Highest effort, highest risk — tier down (v0) if the calendar slips. |

### PR slicing

1. **PR1 — Guest identity (4A):** `identity.ts` + decouple `GSI1PK`/`author`. *Dynamo.*
2. **PR2 — View tracking (1).** *Dynamo.*
3. **PR3 — My drops (2).** *Dynamo (GSI1).*
4. **PR4 — Tags (3a).** *Dynamo.*
5. **PR5 — Share + per-waypoint SSR + metadata/sitemap (5).** *Dynamo-only —
   `getWaypointById`; sponsored pins never expire so links stay durable (no DSQL fallback).*
6. **PR6 — Optional account (4B).** *DSQL `accounts`.*
7. **PR7 — Channels + private membership + WS authorizer (3b / 4C).** *DSQL SoR + Dynamo
   `MEMBER#` mirror + infra authorizer.*
8. **PR8 — Invites + invite links (4D).** *DSQL `channel_invites`; reuses PR5 SSR + PR6
   signup + PR7 membership.*

> **Cut line:** if the deadline tightens, ship through **PR6** for entry ① (consumer)
> and degrade PR7–8 to v0 (add-by-handle, pre-seeded accounts) for entry ②. Never let
> the private-channel surface area threaten the core radar demo — that's the thing the
> judges actually watch run.
