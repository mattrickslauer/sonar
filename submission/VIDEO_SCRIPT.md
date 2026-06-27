# Sonar — demo video script (≤ 3:00) · production cut

> **Hard limit: under 3 minutes** — judges stop watching at 3:00. This cut lands at **~2:45**.
> Required beats, all covered: **the problem · for whom · why this problem · footage of the working app · which AWS Databases and why.**
> Audience = AWS Database judges. Spend the technical third on the **data model**, not the UI.

---

## Production approach

**Sonar is shot entirely on the Insta360 X5 (360°).** No flat camera, no staged re-shoots — we cut from footage already captured:

- **Patagonia light festival** (night, lights, crowd) — the hook and "the place." The dark-field-plus-points-of-light look *is* the Sonar brand: ~80% Deep Field `#05070a`, one Sonar-Green `#34e3a0` signal.
- **Champuzón** (the run into the water) — the energy / crowd / "a place that's alive right now" beat.

**Why all-360:** keeps Sonar stylistically unbroken so it doesn't disrupt the **Tollroad music** piece. The 360 reframe vocabulary — keyframed pans, tiny-planet, push-out-from-center — *is* the Sonar motion language: **signal propagates outward from a center.** Every reframe should emanate, never slide in from an edge.

**Two intentional exceptions to "all 360":**
1. **The live app** appears as **floating, brand-styled UI cards composited over the 360 footage** (radar, the +5-min countdown, the AI answer) — the product lives inside the real world, not as flat screen-rec cuts.
2. **The architecture beat (1:40–2:30)** is **clean flat 2D motion-graphics** — the one deliberate stylistic break, because the judged third has to be legible (geohash cells, `ADD ttl 300`, the DynamoDB→DSQL flow). We cut to it on a sweep wipe and cut back to 360 for the close.

**Source-footage key:** `[LF]` = Patagonia light festival · `[CH]` = Champuzón · `[UI]` = floating app card over 360 · `[MG]` = flat motion-graphics · `[ACC]` = AI accent (logo ping / sweep wipe).

---

## Timeline

| Time | On screen | Voiceover |
|---|---|---|
| **0:00–0:12** · Hook | `[LF]` Cold open inside the light festival at night — reframe **pushing out from a single light** so the whole field opens up around it. `[ACC]` the Sonar logo ping animates in on that center, then the tagline. | "Snapchat forgets everything. Instagram forgets nothing. But a *place* — a festival, a campus, a downtown block — has a living memory of what's happening *right now*. **Sonar is that layer.**" |
| **0:12–0:35** · Problem & who | `[CH]` Quick 360 reframes across the Champuzón crowd — motion, people, someone scanning around. Floating Geist-Mono text: *"is it worth going over there — right now?"* | "If you're somewhere busy, you have one question: *is it worth going over there, right now?* No feed answers that — they're all timeless. The people who feel this most are festival-goers, students, conference crowds — anyone in a dense, time-sensitive place." |
| **0:35–1:05** · What it does | `[LF]` Reframe to a hand/phone in the festival. `[UI]` A **floating radar card** fades in anchored in frame; a waypoint drops onto the **Food** channel (photo + text) and pings outward. Then the money shot: `[UI]` a **floating countdown card** — tap like, and the timer visibly **jumps +5:00** each tap. | "You drop a **waypoint** — note, photo, video, or voice — onto a channel. It streams in live to everyone nearby and **expires in 24 hours**. But watch the timer: **every like adds five minutes.** Likes literally buy time — the crowd keeps the good stuff alive." |
| **1:05–1:25** · Ask the place | `[LF]` Hold on the festival field. `[UI]` A floating **Ask** bar types *"What's the vibe at the main stage?"* → a brand-styled answer card resolves, summarizing recent drops. | "And you can just **ask the place.** Sonar summarizes everything dropped here in the last day and answers — no scrolling. There's no vector database behind this. I'll come back to why." |
| **1:25–1:40** · Monetization | `[LF]` Reframe toward a booth/activation in the festival. `[UI]` A **sponsored permanent pin** card with a sponsor label sits steady while ephemeral pings fade around it. | "Nothing users post lasts forever. The *only* permanent pins are **sponsored** — venues and brands pay for a pin that never expires. That's the business model, and it runs through real billing." |
| **1:40–1:44** · Transition | `[ACC]` **Sweep wipe** — the radar arm rotates across frame and wipes from 360 into flat black (`#05070a`). | *(music carries; no VO)* |
| **1:40–2:30** · The architecture (the part judges score) | `[MG]` **Flat 2D motion-graphics on Deep Field.** Beat 1: a **geohash grid** ignites — one cell plus its 8 neighbors light Sonar-Green. Beat 2: a drop with a **TTL ring**; a `like` fires and a mono counter ticks **`ADD ttl 300`**, the ring grows. Beat 3: **Streams** fan green lines out to WebSocket dots. Beat 4: split — **DynamoDB** (radar) on the left, **Aurora DSQL** (accounts · subscriptions · sponsorships · analytics) on the right, an **IAM** key between them. Beat 5: an "ask the place" query bounded by a **geofence + 24h window**, and a **vector DB icon crossed out**. | "Here's the part we're proud of. Sonar is **polyglot and all-serverless**, two AWS databases each chosen for its access pattern. **DynamoDB is the radar** — items are keyed by **geohash**, so 'what's near me' is a key query of my cell plus eight neighbors, never a scan. The 24-hour expiry is a native **TTL**, and *'likes buy time' is an atomic `ADD ttl 300` — the feature is written directly into the storage layer.* **Streams** fan new drops out to WebSocket subscribers and roll usage up for billing. Then **Aurora DSQL** — serverless, scale-to-zero, Postgres-compatible — is the relational system-of-record: accounts, subscriptions, sponsorships, analytics, with **IAM-native auth** and a least-privilege role. And because a geofence plus a 24-hour window bound every AI query, the context fits one model call — **the data model replaces the vector database.**" |
| **2:30–2:34** · Transition | `[ACC]` Sweep wipe back — flat motion-graphics resolve into the radar arm, which opens back out into 360. | *(music carries; no VO)* |
| **2:34–2:45** · Close | `[LF]` Back inside the festival, phone in hand showing the live radar; `mysonar.zone` visible in the address bar. `[ACC]` Logo ping + tagline settle on the center. | "Two databases, each doing what it's best at. It's live right now at **mysonar.zone**, on Vercel and AWS. Sonar — **the layer where places remember.**" |

**Runtime: ~2:45.** If you need to trim, cut the monetization beat (1:25–1:40) to reach ~2:30.

---

## Source-footage shot list (from existing X5 captures)

Pull and reframe these — no new shoot required.

**Patagonia light festival `[LF]`**
- [ ] Push-out-from-a-single-light open (the hook). Find the cleanest single point of light to center on.
- [ ] A wide reframe of the field with scattered lights (reads as live pings on a dark radar).
- [ ] A hand/phone in the scene (for the floating-UI composites — drop, like, ask).
- [ ] A booth / activation / branded structure (for the sponsored-pin beat).
- [ ] A calm hold for the close, phone showing the radar with `mysonar.zone` in the bar.

**Champuzón `[CH]`**
- [ ] Crowd motion / people scanning around (the "is it worth going over there?" problem beat).
- [ ] One high-energy moment (the run/water) to prove "a place that's alive *right now*."

**360 reframing rules**
- Every move **emanates from a center** — push out, orbit, or tiny-planet-unfold. Never slide in from a frame edge.
- Match the brand ratio: keep frames dark, let the green/lights be the only saturated thing. ~80% Deep Field.
- Export reframes at **1080×1920 vertical** (judges watch on laptops, but vertical reads as "phone/radar" and matches the product). Confirm the festival's preferred deliverable; 16:9 1080p is the safe default if unsure.

---

## Floating-UI card spec `[UI]`

The app moments are **real screen recordings composited as cards over the 360**, styled to brand so they read as part of the world, not a cut:

- **Surface:** Deep Field `#05070a` at ~92% opacity, 1px Sonar-Deep `#1b8c63` border, 20px radius, soft outward green glow (the card itself "pings" in: scale 0.96→1, ease-out).
- **Type:** Geist for labels, **Geist Mono for the countdown / counters / coordinates** (the "instrument readout" voice).
- **Anchor:** lock each card to a point in the 360 scene (over the phone, beside a light) so it holds as the reframe moves — it should feel placed in space.
- **The three cards:** (1) radar + drop-a-waypoint, (2) **the +5:00 countdown — get this crisp, it's the money shot**, (3) the Ask answer.

---

## AI-visual prompt pack (flat architecture beat + accents)

Generate on Deep Field, one green signal. Paste into your image/video generator; keep the palette literal.

**Global style suffix (append to every prompt):**
> `Dark UI motion-graphics, background #05070a (near-black). Single accent color Sonar-Green #34e3a0; secondary green #1b8c63 for inactive/borders. Text in Signal White #e6f0ee (never pure white) and Geist Mono for numbers. Thin hairline grid rgba(52,227,160,0.16). Minimal, calm, technical "instrument readout" aesthetic — not flashy. Motion emanates outward from a center. 16:9.`

1. **Geohash grid** — "A dark map grid of equal cells; one center cell and its 8 neighbors ignite Sonar-Green while the rest stay dim; a soft ping radiates from the center cell. Mono label `CH#food#GEO#9q8yyk`."
2. **TTL / likes-buy-time** — "A single glowing point with a thin countdown ring around it reading `23:59:50` in Geist Mono; a `♥ like` triggers and the ring steps up as a counter prints `ADD ttl 300` and `+5:00`; the ring grows outward. The hero shot of the technical beat."
3. **Streams fan-out** — "From a central database glyph, thin green lines fan outward to small connected dots labeled `WS`, each pulsing as data arrives. Label `DynamoDB Streams → WebSocket`."
4. **Two-database split** — "Left: a glyph labeled `DynamoDB — the radar (geohash, TTL, Streams)`. Right: a glyph labeled `Aurora DSQL — accounts · subscriptions · sponsorships · analytics`. A small key icon labeled `IAM` sits between them. Clean, balanced, schematic."
5. **No vector DB** — "An 'ask the place' query glyph bounded by a circular geofence and a `24h` window; beside it a generic vector-database cylinder with a thin line struck through it. Caption in Signal White: `the data model replaces the vector database`."
6. **Sweep wipe (accent)** — "A radar sweep arm, Sonar-Green, rotating 5s linear across a dark field, leaving a fading green trail; used as a transition wipe between 360 footage and flat graphics."
7. **Logo ping (accent)** — "A single Sonar-Green ring with a solid center dot pinging outward (scale 0.4→2.4, fade) on Deep Field; resolves to the 'Sonar' wordmark in Geist 600, tagline `The layer where places remember.` below."

*(Fallback for the architecture beat: a clean frame exported from `ARCHITECTURE_DIAGRAM.pdf` or `submission/DECK.html`, held under the VO, with the geohash/TTL callouts animated on top.)*

---

## Music & consistency notes (Tollroad)

- Score the whole piece to the **Tollroad music** track; cut reframes and card-pings **on the beat**. The all-360 look exists to stay coherent with that piece — don't break it except for the deliberate flat architecture third.
- The flat motion-graphics section should still **breathe with the music** so the stylistic break reads as intentional, not jarring. Sweep-wipe in *and* out on a downbeat.
- Keep energy **calm and confident** — brand voice is a *calm instrument*, not a hype reel. Let the music carry; the VO sits under it.

## Narration notes

- Say the database names **out loud** — "DynamoDB", "Aurora DSQL" — judges are listening for them.
- The single most important sentence: **"'likes buy time' is an atomic TTL update — the feature is the database."** Don't rush it; it lands on the `ADD ttl 300` graphic.
- Second most important: **"the data model replaces the vector database."** It lands on the crossed-out vector-DB graphic.
- Avoid "post" and "feed" — it's a **radar**. Our verbs: *drop · ask · ping · subscribe · expire · keep alive.*
- Upload to **YouTube** (preferred), public (not unlisted), title includes "Sonar" and "H0 Hackathon".
