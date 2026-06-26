# Drop Composer Cleanup + Byte-Hour Coupling

**Date:** 2026-06-26
**Status:** Approved, implementing

## Goal

Simplify the drop composer and introduce a "byte-hour" mechanic where a drop's
chosen lifespan governs its maximum upload size — the longer it lives, the
smaller it must be. Pair this with a heat gradient on the lifespan buttons so the
composer visibly shifts cooler → hotter as you pick longer lifespans.

## Decisions (locked)

- **Channels:** replace the channel chip row with a single search-or-create
  input. Defaults to `general`.
- **Byte-hour:** hand-tuned table mapping each lifespan preset to a max size
  (not a live formula).
- **Heat direction:** long = hot red. 24h is red-hot (carries few MB); 15m is
  cool (carries a fat payload). Heat reads as "how long it has to burn."
- **Voice:** hidden (removed from the kind selector), not deleted. Type +
  server plumbing stay intact for a clean re-enable later.
- **Default lifespan:** 15m.

## Changes

### 1. Composer UI (`src/components/DropComposer.tsx`)
- Remove the channel chip row; add a search-or-create input that filters the
  user's existing channels live and offers "Create #name" on no match. Reuses
  the `createOrJoinChannel` path via a callback from `page.tsx`. Default
  selection = `general`.
- Remove `voice` from `KINDS` (→ `text / photo / video`).
- Default lifespan state = 15m.
- Re-validate the picked file whenever the lifespan changes; show an inline
  "too big for <life> (max <N>)" error and disable Drop until resolved.

### 2. Byte-hour table (`src/lib/waypoints.ts`)
Extend `LIFESPAN_PRESETS` so each entry carries `maxBytes` and a heat `color`:

| Lifespan | Max size | Heat color |
|----------|----------|------------|
| 15m      | 50 MB    | cool blue  |
| 1h       | 30 MB    | teal       |
| 6h       | 15 MB    | amber      |
| 12h      | 8 MB     | orange     |
| 24h      | 3 MB     | hot red    |

`DEFAULT_LIFESPAN_SECONDS` → 15m.

### 3. Size enforcement (`src/lib/media.ts` + upload route)
- The lifespan now sets the byte cap (a single per-drop budget), replacing the
  flat per-kind cap. The MIME-family check (image/* vs video/*) stays. Text
  ignores the cap.
- `validateMedia` (or a new helper) takes the lifespan-derived cap.
- `/api/media/upload` accepts the chosen `lifespanSeconds` and sets the
  presigned-POST `content-length-range` from the same shared table, so client
  and server enforce the identical number.

### 4. Heat gradient styling
- Active lifespan button glows in its heat color (dim when inactive).
- The size-cap hint and the Drop button tint follow the selected lifespan's
  heat color.

## Out of scope
- Permanent / $5/mo option unchanged.
- Voice deletion (only hidden).
- love-extends-life unchanged.

## Addendum: private channel creation from the composer

- A **Public ⇄ Private toggle** sits to the right of the channel input row,
  defaulting to **Public**. Toggling it on treats the typed name as a new
  **locked** channel.
- While private is on, a small note under the channel input explains the
  **per-member, per-hour** billing model (the price is configured in Stripe, so
  the copy is qualitative); the note is hidden in public mode.
- On **submit**, a named private channel (slug ≥ 2 chars) routes to **Stripe
  Checkout** (like the permanent option) via `onResolveChannel(name, true)`.
  Requires sign-in (signed-out → `onRequireSignIn`).
- Public type-ahead suggestions are suppressed in private mode (a locked channel
  is always newly created, never joined).

## Addendum: create-a-channel-here also drops

Creating a channel inside the composer now produces the drop in one action:

- **Public new channel:** the Drop button resolves/creates the typed channel,
  then drops into it. The channel pill always previews the resolved target (new
  public `＋slug`, an exact existing match, or the current selection) so the
  action is never a surprise.
- **Private new channel:** since the drop can't post until the channel is paid
  and active, the composer uploads any media, **stashes the draft**
  (`stashPendingDrop` → sessionStorage), then redirects to Checkout. On return
  (`?locked=success`), `page.tsx` arms the draft and posts it once the channel
  shows up in the user's channel list (webhook-seeded membership); the
  post-Checkout poll window was widened to cover activation latency.
- **Enabling fixes:** the media-upload route accepted only the 6 core channels
  (`CHANNEL_MAP`); relaxed to any valid slug (`isValidChannelId`) so media into
  custom/locked channels works, and the S3 key regex now allows digits in the
  channel segment.

## Addendum: globally-unique channel names (no duplicates)

Channel names are now unique across the whole registry — a name claimed
privately can't be reused publicly and vice versa, and duplicates are
impossible:

- **Private channels now key on the normalized slug** (same as public), instead
  of a random id. The `channels` table PK enforces uniqueness for free — no
  migration. Verified safe: every private-channel read/post/subscribe path gates
  on `channel_members` membership (radar route, drop route, WS authorizer), not
  on the id being unguessable, and private channels never appear in public
  search — so a predictable slug id exposes nothing.
- **`searchOrCreateChannel`** (public) throws `ChannelTakenError` if the slug is
  already a private channel (→ 409) instead of joining/returning it.
- **`createPrivateChannel`** derives the id from the slug and throws
  `ChannelTakenError` if the slug already exists — *except* when the same owner
  is re-attempting their own still-`locked_unpaid` channel, so they can resume
  Checkout.
- `resolveChannel` (client) now throws on failure so the composer surfaces the
  message inline and clears any stashed pending drop (no orphaned draft firing
  on a later checkout). Dead `randomChannelId`/`ID_ALPHABET` removed.
- Note: pre-existing private channels created with random ids keep working; the
  uniqueness rule applies to new creations.

## Open tuning knobs
- 24h video cap of 3 MB is intentionally tight; easy to bump.
- Per-drop total budget (chosen) vs per-kind — chose per-drop total.
