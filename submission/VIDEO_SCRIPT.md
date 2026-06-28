# Sonar — demo video script (≤ 3:00) · production cut

> **Hard limit: under 3 minutes** — judges stop watching at 3:00. This cut lands at **~2:35**.
> Required beats, all covered: **the problem · for whom · why this problem · footage of the working app · which AWS Databases and why.**
> Audience = AWS Database judges. Spend the technical third on the **data model**, not the UI.

---

## Production approach

**Sonar is shot entirely on the Insta360 X5 (360°).** No flat camera, no staged re-shoots — we cut from footage already captured:

- **Patagonia light festival** (night, lights, crowd) — the hook and "the place." The dark-field-plus-points-of-light look *is* the Sonar brand: ~80% Deep Field `#05070a`, one Sonar-Green `#34e3a0` signal.
- **Champuzón** (the run into the water) — the energy / crowd / "a place that's alive right now" beat.

**Why all-360:** keeps Sonar stylistically unbroken so it doesn't disrupt the **Tollroad music** piece. The 360 reframe vocabulary — keyframed pans, tiny-planet, push-out-from-center — *is* the Sonar motion language: **signal propagates outward from a center.** Every reframe should emanate, never slide in from an edge.

**Two intentional exceptions to "all 360":**
1. **The live app** appears as **floating, brand-styled UI cards composited over the 360 footage** (radar, the cool→hot lifespan picker, the +5-min countdown, the AI answer) — the product lives inside the real world, not as flat screen-rec cuts.
2. **The architecture beat (1:35–2:22)** is **clean flat 2D motion-graphics** — the one deliberate stylistic break, because the judged third has to be legible (geohash cells, the lifespan↔size dial, `ADD ttl 300`, the DynamoDB→DSQL flow). We cut to it on a sweep wipe and cut back to 360 for the close.

**Source-footage key:** `[LF]` = Patagonia light festival · `[CH]` = Champuzón · `[UI]` = floating app card over 360 · `[MG]` = flat motion-graphics · `[ACC]` = AI accent (logo ping / sweep wipe).

**Voice:** the VO is deliberately short and plain — calm instrument, not a hype reel. The full read-through is in [`VOICEOVER.txt`](./VOICEOVER.txt); the table below maps each line to picture.

---

## Timeline

| Time | On screen | Voiceover |
|---|---|---|
| **0:00–0:12** · Hook | `[LF]` Cold open inside the light festival at night — reframe **pushing out from a single light** so the whole field opens up around it. `[ACC]` the Sonar logo ping animates in on that center, then the tagline. | "Snapchat forgets everything. Instagram forgets nothing. But a place — a festival, a campus, a city block — remembers what's happening right now. **Sonar is that layer.**" |
| **0:12–0:32** · Problem & who | `[CH]` Quick 360 reframes across the Champuzón crowd — motion, people, someone scanning around. Floating Geist-Mono text: *"is it worth going over there — right now?"* | "When you're somewhere busy, you've got one question: *is it worth going over there, right now?* No feed answers that — they're all timeless. Festival-goers, students, conference crowds — anyone in a packed, fast-moving place feels it." |
| **0:32–1:05** · What it does | `[LF]` Reframe to a hand/phone in the festival. `[UI]` A **floating radar card** fades in; a waypoint drops onto the **Food** channel and pings outward. `[UI]` A **lifespan-picker card** glows cool→hot (15m blue → 24h red); as the finger moves toward a longer life, the size cap visibly **tightens 50 MB → 3 MB**. Then the money shot: `[UI]` a **floating countdown card** — tap like, the timer **jumps +5:00** each tap. | "So you drop a **waypoint** — a note, a photo, a video — onto a channel, and you **pick how long it lives.** But **life costs size**: a big video burns out in minutes, a small note can last all day. We call it a **byte-hour budget** — the longer it lives, the lighter it has to be. And every like buys it **five more minutes** — the crowd keeps the good stuff alive." |
| **1:05–1:20** · Ask the place | `[LF]` Hold on the festival field. `[UI]` A floating **Ask** bar types *"What's the vibe at the main stage?"* → a brand-styled answer card resolves, summarizing recent drops. | "Or just **ask the place.** Sonar reads everything dropped around you today and answers — no scrolling. No vector database behind it. I'll tell you why." |
| **1:20–1:32** · Monetization | `[LF]` Reframe toward a booth/activation in the festival. `[UI]` A **sponsored permanent pin** card with a sponsor label sits steady while ephemeral pings fade around it. | "Nothing here lasts forever — except **sponsored** pins. Brands pay for a pin that never expires. That's the business." |
| **1:32–1:35** · Transition | `[ACC]` **Sweep wipe** — the radar arm rotates across frame and wipes from 360 into flat black (`#05070a`). | *(music carries; no VO)* |
| **1:35–2:22** · The architecture (the part judges score) | `[MG]` **Flat 2D motion-graphics on Deep Field.** Beat 1: a **geohash grid** ignites — one cell plus its 8 neighbors light Sonar-Green. Beat 2: a drop with a **TTL ring**; a **lifespan dial** (15m→24h) sets the ring *and* a byte-cap readout (`50 MB`→`3 MB`) in one move, then a `like` fires and a mono counter ticks **`ADD ttl 300`**, the ring grows. Beat 3: **Streams** fan green lines out to WebSocket dots. Beat 4: split — **DynamoDB** (radar) on the left, **Aurora DSQL** (accounts · payments · sponsorships · analytics) on the right. Beat 5: an "ask the place" query bounded by a **geofence + 24h window**, and a **vector DB icon crossed out**. | "Now the part we're proud of. Sonar runs on **two AWS databases**, each picked for one job. **DynamoDB is the radar** — drops are keyed by **geohash**, so 'what's near me' is a single key lookup, never a scan. *Expiry lives in the database itself: the lifespan you pick sets the TTL and the upload size limit together,* and a like is one atomic **TTL** write that adds five minutes. **The feature is the database.** **Streams** push every new drop out live to the people nearby. Then **Aurora DSQL** — serverless, scales to zero — holds what has to be exact: accounts, payments, sponsorships, analytics. And because every question is bounded by here and today, the answer fits a single model call. **There's no vector database — the data model replaces it.**" |
| **2:22–2:25** · Transition | `[ACC]` Sweep wipe back — flat motion-graphics resolve into the radar arm, which opens back out into 360. | *(music carries; no VO)* |
| **2:25–2:36** · Close | `[LF]` Back inside the festival, phone in hand showing the live radar; `mysonar.zone` visible in the address bar. `[ACC]` Logo ping + tagline settle on the center. | "Two databases, each doing what it's best at. Live right now at **mysonar.zone**. Sonar — **the layer where places remember.**" |

**Runtime: ~2:35.** Comfortable margin under 3:00. If you need to trim further, cut the monetization beat (1:20–1:32) to reach ~2:23.

---

## Source-footage shot list (from existing X5 captures)

Pull and reframe these — no new shoot required.

**Patagonia light festival `[LF]`**
- [ ] Push-out-from-a-single-light open (the hook). Find the cleanest single point of light to center on.
- [ ] A wide reframe of the field with scattered lights (reads as live pings on a dark radar).
- [ ] A hand/phone in the scene (for the floating-UI composites — drop, pick-a-lifespan, like, ask).
- [ ] A booth / activation / branded structure (for the sponsored-pin beat).
- [ ] A calm hold for the close, phone showing the radar with `mysonar.zone` in the bar.

**Champuzón `[CH]`**
- [ ] Crowd motion / people scanning around (the "is it worth going over there?" problem beat).
- [ ] One high-energy moment (the run/water) to prove "a place that's alive *right now*."

**360 reframing rules**
- Every move **emanates from a center** — push out, orbit, or tiny-planet-unfold. Never slide in from a frame edge.
- Match the brand ratio: keep frames dark, let the green/lights be the only saturated thing. ~80% Deep Field.
- Export reframes at **1080×1920 vertical** (vertical reads as "phone/radar" and matches the product). Confirm the festival/Tollroad deliverable; 16:9 1080p is the safe default if unsure.

---

## Floating-UI card spec `[UI]`

The app moments are **real screen recordings composited as cards over the 360**, styled to brand so they read as part of the world, not a cut:

- **Surface:** Deep Field `#05070a` at ~92% opacity, 1px Sonar-Deep `#1b8c63` border, 20px radius, soft outward green glow (the card itself "pings" in: scale 0.96→1, ease-out).
- **Type:** Geist for labels, **Geist Mono for the countdown / counters / coordinates** (the "instrument readout" voice).
- **Anchor:** lock each card to a point in the 360 scene (over the phone, beside a light) so it holds as the reframe moves — it should feel placed in space.
- **The four cards:** (1) radar + drop-a-waypoint, (2) **the lifespan picker — buttons glow cool→hot (15m `#4cc9f0` → 24h `#e63946`), the size cap stepping 50 MB → 3 MB as life grows** (the "byte-hour" visual; heat reads as "how long it has to burn"), (3) **the +5:00 countdown — get this crisp, it's the money shot**, (4) the Ask answer.

---

## AI-visual prompt pack (flat architecture beat + accents)

Generate on Deep Field, one green signal. Paste into your image/video generator; keep the palette literal.

**Global style suffix (append to every prompt):**
> `Dark UI motion-graphics, background #05070a (near-black). Single accent color Sonar-Green #34e3a0; secondary green #1b8c63 for inactive/borders. Text in Signal White #e6f0ee (never pure white) and Geist Mono for numbers. Thin hairline grid rgba(52,227,160,0.16). Minimal, calm, technical "instrument readout" aesthetic — not flashy. Motion emanates outward from a center. 16:9.`

1. **Geohash grid** — "A dark map grid of equal cells; one center cell and its 8 neighbors ignite Sonar-Green while the rest stay dim; a soft ping radiates from the center cell. Mono label `CH#food#GEO#9q8yyk`."
2. **TTL / byte-hour / likes-buy-time** — "A single glowing point with a thin countdown ring; a lifespan dial sweeps `15m → 24h` and the ring resizes while a Geist-Mono byte-cap readout counts `50 MB → 3 MB` in lockstep (longer life = smaller payload, the byte-hour trade). Then a `♥ like` triggers and a counter prints `ADD ttl 300` and `+5:00`; the ring grows outward. The hero shot of the technical beat — storage time and storage size on one control."
3. **Streams fan-out** — "From a central database glyph, thin green lines fan outward to small connected dots labeled `WS`, each pulsing as data arrives. Label `DynamoDB Streams → WebSocket`."
4. **Two-database split** — "Left: a glyph labeled `DynamoDB — the radar (geohash, TTL, Streams)`. Right: a glyph labeled `Aurora DSQL — accounts · payments · sponsorships · analytics`. Clean, balanced, schematic."
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

- Keep the VO **short and unhurried** — the script is deliberately plain so it doesn't fight the music. Don't cram; leave air between lines.
- Say the database names **out loud** — "DynamoDB", "Aurora DSQL" — judges are listening for them. Also land "geohash", "TTL", and "Streams".
- The single most important line: **"the feature is the database"** — it lands on the `ADD ttl 300` graphic. Don't rush it.
- Land the **byte-hour** line — *"life costs size … we call it a byte-hour budget"* on the cool→hot lifespan picker, and *"the lifespan you pick sets the TTL and the upload size limit together"* on the lifespan-dial graphic. It's the freshest differentiator: storage *time* traded against storage *size* in one control. Default lifespan is **15m**, max **24h** — don't imply everything lives a full day.
- Second-most-important: **"the data model replaces the vector database"** — lands on the crossed-out vector-DB graphic.
- Avoid "post" and "feed" — it's a **radar**. Our verbs: *drop · ask · ping · subscribe · expire · keep alive.*
- Upload to **YouTube** (preferred), public (not unlisted), title includes "Sonar" and "H0 Hackathon".
