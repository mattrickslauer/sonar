# Channel join links + management

**Date:** 2026-06-24
**Status:** Approved (build + merge locally)

## Goal

Let users view the private channels they own or belong to, share a join link that
lets anyone (including anonymous visitors) join the channel, and let owners manage
their channels — copy/rotate the link, invite by email, remove members, and cancel
the channel.

## What already exists (no change)

- `channels` table (private channels have random unguessable ids; `status`
  `locked_unpaid` → `active` after the Stripe webhook confirms payment and seeds
  the owner as an `owner`-role member).
- `channel_members` allow-list (DSQL authoritative + DynamoDB mirror the WS
  authorizer reads). `addMember` / `removeMember` keep both in sync.
- `POST /api/channels/[id]/members` (invite by email/accountId, owner-only).
- `DELETE /api/channels/[id]/members/[accountId]` (revoke, owner-only).
- `DELETE /api/channels/[id]` (cancel locked channel, owner-only).
- `GET /api/channels?anonId=` already returns active private channels you belong to.
- Anonymous accounts (`accounts` row, `claimed_at = null`, id = client UUID);
  `resolveIdentity(req, anonId, { ensure })` lazily creates them.

## Design

### 1. Join-link model — open link, instant join (owner can revoke)

A new **`join_token`** column on `channels` (random, URL-safe, distinct from the
live channel id which is reused on the WS/map paths and must not become a public
join secret). The public link is `/j/<join_token>`.

- Lazily generated the first time the owner views the link.
- **Rotation** = regenerate the token → old links 404. This is the link-level
  complement to per-member revoke.

`009_channel_join_token.sql`: add `join_token text` + `CREATE UNIQUE INDEX ASYNC`
on it. Grant unchanged (`channels` already has UPDATE).

### 2. Anonymous join flow — confirmation screen

Route `app/j/[token]/page.tsx` (client component, `use(params)`):

- On mount, `GET /api/join/[token]` → `{ channel: { label, emoji, color }, alreadyMember }`
  (no channel id leaked pre-join). 404 → "this link is no longer valid".
- Shows channel name/emoji + an **optional display-name field** (otherwise anon
  members all show as "you") + a **Join** button.
- Join → `POST /api/join/[token] { anonId, displayName? }`:
  - `resolveIdentity(req, anonId, { ensure: true })` (creates the anon account if new,
    or uses the session if signed in).
  - If `displayName` given and the account is unclaimed, set it
    (`setDisplayNameIfUnclaimed`).
  - `addMember(channelId, userId, "member")` (idempotent; writes DSQL + DynamoDB).
  - Returns `{ channelId }`.
- On success the page writes the channel id into the `sonar_channels` localStorage
  set (so the dock shows it toggled-on) and redirects to `/`.

Join only resolves **active private** channels; `locked_unpaid`/`expired`/public →
404.

### 3. New / changed APIs

- `GET /api/join/[token]` — public preview (no auth).
- `POST /api/join/[token]` — join (session or anonId).
- `GET /api/channels/[id]/join-token` — owner: get-or-create token → `{ token }`.
- `POST /api/channels/[id]/join-token` — owner: rotate token → `{ token }`.
- `POST /api/channels/[id]/leave` — self leave (session or anonId); the owner can't
  leave (must cancel instead).
- `GET /api/me/channels` — channels the caller owns/belongs to, with role
  (static path, no collision with `channels/[id]`). Returns
  `{ channels: [{ id, label, emoji, color, private, status, role, isOwner }] }`.

Server additions:
- `channels.ts`: `join_token` in `ChannelRow`/`SELECT_COLS`; `randomJoinToken()`,
  `getOrCreateJoinToken(id)`, `rotateJoinToken(id)`, `getChannelByJoinToken(token)`,
  `listMyChannelsWithRole(accountId)`.
- `membership.ts`: `listMembers` LEFT JOINs `accounts` → `MemberRow` gains
  `displayName`, `handle`.
- `accounts.ts`: `setDisplayNameIfUnclaimed(id, name)`.

### 4. "My Channels" sheet (new UI)

`src/components/MyChannelsSheet.tsx`, opened from `ClaimSheet`'s signed-in menu via
a new `onManageChannels` prop (page.tsx adds `channelsOpen` state, mirrors the
existing `manageOpen`/ManageSheet wiring). Styled to match ClaimSheet/ManageSheet.

- **List view:** my channels with a role badge (Owner / Member).
- **Owner detail:** copyable join link + "Regenerate", invite-by-email field,
  member list with remove buttons (owner row not removable), "Cancel channel"
  (confirm).
- **Member detail:** channel info + "Leave channel".

Client helpers in `channels.client.ts`: `fetchMyChannels`, `fetchJoinPreview`,
`joinViaToken`, `getJoinLink`, `rotateJoinLink`, `listChannelMembers`,
`removeChannelMember`, `leaveChannel`. (Reuse existing `inviteMember`,
`cancelChannel`, `saveVisibleChannels`/`loadVisibleChannels`.)

## Out of scope / known tradeoffs

- **Billing exposure:** an open link bills per member-hour. Mitigations in scope:
  rotate the link, remove members. Hard caps / expiry / approval were declined.
- Anonymous members can join via link but the "My Channels" entry button is shown
  only to signed-in accounts; the `leave` API still accepts an anonId.
- No automated test runner is installed (scripts: dev/build/start/lint).
  Verification = `tsc`/`next build`/`eslint` + the manual demo path:
  create private channel → copy link → open incognito → confirm → join → owner sees
  the new member → owner removes them.

## Files

- `infra/sql/009_channel_join_token.sql` (new)
- `src/lib/server/channels.ts`, `membership.ts`, `accounts.ts` (edit)
- `src/app/api/join/[token]/route.ts` (new)
- `src/app/api/channels/[id]/join-token/route.ts` (new)
- `src/app/api/channels/[id]/leave/route.ts` (new)
- `src/app/api/me/channels/route.ts` (new)
- `src/lib/channels.client.ts` (edit)
- `src/app/j/[token]/page.tsx` (new)
- `src/components/MyChannelsSheet.tsx` (new)
- `src/components/ClaimSheet.tsx`, `src/app/page.tsx` (edit — wiring)
