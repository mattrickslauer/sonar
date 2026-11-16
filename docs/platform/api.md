# Sonar Platform API (v1)

Sonar's engine as a service. Your app keeps its own users, its own sign-in and its own brand; Sonar runs underneath —
place-anchored posts that fade in 24 hours, likes that buy them time, permanent sponsored pins, photo uploads with
automatic moderation, and usage you can see. Like Stripe: your users never see the word "Sonar".

First customer: **puq.city** (Punta Arenas). Its citizens scan a shop's counter QR, take a photo there, and the post
lands on the shop's public wall through this API.

## Concepts

| Sonar term | What it is |
|---|---|
| **Tenant** | Your app. Every post, like and file is scoped to one tenant and invisible to the others and to mysonar.zone. |
| **API key** | `sk_live_…`, server-side only. Identifies the tenant. Never ship it to a browser. |
| **User** | *Your* user. You pass `user: { id, name }`; Sonar trusts it, stores it scoped to your tenant, and never asks them to sign in. |
| **Post** | A waypoint: text, photo, video or 15 s voice at a `lat`/`lng`, on a `channel`, optionally tied to a `place`. |
| **Place** | Your own id for a spot (`shop:cafe-tapiz`, `stage:north`). Gives you a per-place feed (a photo wall). |
| **Channel** | Your own topic slug (`claims`, `food`, `events`). Free-form, `[a-z0-9-]{1,32}`. |
| **Lifespan** | Posts fade after 24 h by default (min 15 min). Every like adds 5 minutes, uncapped. |
| **Sponsored pin** | `lifespan: "permanent"` + a `sponsor` label: never expires. Use it for drops, offers, landmarks. |

## Authentication

```
Authorization: Bearer sk_live_YOUR_KEY
```

Keys are stored hashed; Sonar shows a key once, when it is made. Missing/unknown/revoked key → `401`. A suspended
tenant → `403`. Each tenant has a per-minute request budget (default 600) → `429` with `Retry-After`.

Base URL: `https://mysonar.zone/api/v1`

Errors are always `{ "error": { "code": "…", "message": "…" } }`.

## Endpoints

### `POST /media` — get an upload ticket

```json
{ "kind": "photo", "contentType": "image/jpeg" }
```
→ `201 { "key": "tenants/puq/3f…a9.jpg", "url": "https://…s3…", "fields": { … } }`

POST the file as `multipart/form-data` to `url` with every field in `fields` first, then `file`. The ticket lasts 5
minutes. Limits: photo 10 MB (`image/*`), video 50 MB (`video/*`), voice 10 MB (`audio/*`). Your server can hand the
ticket to your user's browser — it carries no key. Browser uploads are allowed from the origins on your tenant.

### `POST /posts` — create a post

```json
{
  "user": { "id": "citizen_42", "name": "Ana" },
  "channel": "claims",
  "kind": "photo",
  "text": "Sunday coffee at Café Tapiz",
  "lat": -53.1625, "lng": -70.9081,
  "place": "shop:cafe-tapiz",
  "mediaKey": "tenants/puq/3f…a9.jpg",
  "lifespan": 86400,
  "meta": { "drop": "drp_9", "reward": 12 }
}
```

- `kind`: `text` | `photo` | `video` | `voice`; media kinds need a `mediaKey` from `POST /media`.
- `text` ≤ 2,000 chars. `place` ≤ 64 chars `[A-Za-z0-9:._-]`. `meta` ≤ 2 KB of JSON, returned as-is.
- `lifespan`: seconds, 900–86,400 (default 86,400), or `"permanent"` with `"sponsor": "Café Tapiz"`.
- **Moderation:** photos are checked (nudity, violence, gore, hate symbols) before the post exists. A rejected
  photo → `422 { error: { code: "rejected_by_moderation", labels: [...] } }` and no post.

→ `201 { "post": Post }`

### `GET /posts` — read a feed

Either a place wall or what's nearby:

- `?place=shop:cafe-tapiz` — newest first.
- `?lat=-53.16&lng=-70.91&radius=500` — nearest first, radius ≤ 1,800 m.
- Optional: `channel=claims,food`, `limit` (≤ 100, default 50), `user=<id>` (adds `loved` to each post).

Only live posts are returned (expired ones never show). → `200 { "posts": Post[] }`

### `GET /posts/{id}` → `200 { "post": Post }` · `DELETE /posts/{id}` → `200 { "deleted": true }`

Delete is your takedown: a reported post, a reversed reward, a user who leaves.

### `POST /posts/{id}/love` · `DELETE /posts/{id}/love`

```json
{ "user": { "id": "citizen_7" } }
```
One like per user per post. A like adds 5 minutes of life; removing it refunds them.
→ `200 { "love": 3, "counted": true, "expiresAt": 1763412345000 }`

### `GET /usage?days=30`

→ `200 { "tenant": "puq", "hours": [{ "hour": "2026111614", "requests": 120, "posts": 9, "uploads": 9, "moderations": 9 }] }`

## The Post object

```json
{
  "id": "wp_4dj8ex01JD3K…",
  "channel": "claims",
  "kind": "photo",
  "text": "Sunday coffee at Café Tapiz",
  "author": "Ana",
  "userId": "citizen_42",
  "lat": -53.1625, "lng": -70.9081,
  "place": "shop:cafe-tapiz",
  "createdAt": 1763300000000,
  "expiresAt": 1763386400000,
  "permanent": false,
  "sponsor": null,
  "love": 3,
  "loved": false,
  "mediaUrl": "https://…signed, valid 10 minutes…",
  "meters": 42,
  "meta": { "drop": "drp_9", "reward": 12 }
}
```

`meters` is present on nearby reads. `loved` is present when `user` is passed. Re-read a feed to refresh `mediaUrl`.

## Pricing

Usage-based, billed monthly per tenant: requests, posts, stored media and moderation checks, all visible at
`GET /usage`. Early-access partners are onboarded by hand — write to hello@mysonar.zone.

## Coming soon: Sonar Mesh

Posts that travel phone-to-phone over Bluetooth when there is no signal — a festival field, a ferry, the far end of
Patagonia. Each phone carries the place's recent posts and passes them to the next one it meets; when anyone gets back
online, the mesh syncs to Sonar. Same API, same posts, no internet required.

## Operating notes (Sonar side)

- Tenants and keys: `node scripts/platform-tenant.mjs create <id> "<name>" [origin…]`, `key <id>`, `revoke <keyPrefix>`,
  `list`.
- Storage: single `sonar` table. Posts `T#<tenant>#GEO#<gh6>` / `WP#<ulid>`; place feed on GSI1
  `T#<tenant>#PLACE#<place>`; likes `T#<tenant>#WP#<ulid>` / `LOVE#<user>`; tenant `TENANT#<id>`; keys
  `APIKEY#<sha256>`; usage `T#<tenant>#USAGE` / `<yyyymmddhh>`; rate `T#<tenant>#RATE` / `<yyyymmddhhmm>`.
- Media under `tenants/<tenant>/` (not `media/`, which expires after 2 days — sponsored pins need their photo).
- Moderation needs `SONAR_MODERATION=rekognition` and `rekognition:DetectModerationLabels` on the app's IAM user;
  unset, posts carry `"moderation": "off"`.
