# Use case: Sonar at a real event, this weekend

> A concrete, deployable scenario — not a hypothetical. It shows the **Impact & Real-world Applicability** judges exactly who pays, who benefits, and how the architecture earns its keep under real load. Pairs with [`DEPLOYMENT_READINESS.md`](./DEPLOYMENT_READINESS.md).

## The scene: a 30,000-person music festival, two-day, six stages

A regional festival — 30k attendees, six stages, a food-truck village, camping. The recurring failures every festival has:
- *"Which stage is actually good right now?"* — the schedule lies; the crowd knows.
- *"Where's the shortest food/water/bathroom line?"*
- *"My group got separated — what's happening over by the north stage?"*
- *"Is that weather cell going to hit us?"* — safety info travels by rumor.

Today this lives in a Twitter hashtag nobody reads and a festival app that's a static schedule. Sonar replaces both with a **live radar of the grounds**.

## How it plays out

**Attendee (free).** Opens mysonar.zone on their phone (no install — it's a PWA). The radar shows their patch of the festival. They drop a photo on **Music** at the north stage ("this set is insane") and pick how long it lives — anywhere from 15 minutes to a full day, and the longer they want it up, the lighter it has to be (the **byte-hour** trade). It streams to everyone nearby and starts its countdown. As people like it, it lives longer — the genuinely great moments float; the noise expires by morning. They **ask the place** "where's the shortest beer line?" and get a summary of the last hour's drops. Each day resets clean — the radar always reflects *now*.

**Festival operator (the customer who pays).** Buys **sponsored permanent pins** for the medical tent, water stations, and exits — the only pins that never expire — so the essentials stay on every attendee's radar all weekend. They get the **operator view**: an anonymized congestion read of which geohash cells are hot — *the food village is overloaded, the south field is empty* — to redeploy staff in real time. Aurora DSQL holds the accounts, the sponsorship records, and the analytics rollups.

**Sponsor / brand.** A beverage brand buys a permanent pin at their activation booth — it carries their name, never expires for the event, and shows on every attendee's radar. That's the revenue line, and it runs through real Stripe billing.

## Why the architecture earns its keep here (the judge-facing point)
This scenario is a stress test that maps 1:1 to the data design:

- **Spiky, geo-dense writes.** 30k people dropping and liking during a headliner = a write storm concentrated on a few geohash cells. **DynamoDB on-demand + geohash partition keys** absorb it with no provisioning, and "what's near me" stays a key query of one cell + 8 neighbors — never a scan.
- **Everything expires.** A festival is the canonical ephemeral place — Saturday's drops are noise by Sunday. **Native TTL** does the cleanup for free; **likes (`ADD ttl 300`)** let the crowd curate without a ranking team.
- **Real-time is the product.** A radar that isn't live is just a map. **Streams → Lambda → WebSocket fan-out** push drops to subscribers in range the instant they land.
- **Money and safety must be correct and durable.** Sponsorships, accounts, and the operator's analytics can't live in an ephemeral store — that's **Aurora DSQL**, scale-to-zero so the operator isn't paying for idle compute between events.
- **No vector DB.** "Ask the place" is bounded by the geofence + 24h window, so it's one model call — the festival's data *is* the index.

## Who else this is, unchanged
The same engine, different seed data and context:
- **University campus** — orientation week, club fairs, "what's happening on the quad". Episodic spikes, same shape.
- **Conference / trade show** — session buzz, booth traffic, "which talk is worth switching to".
- **Sonar for Work** (B2B, Track 2) — an office park or multi-tenant building: Facilities / Amenities / Events / Security channels, "ask the building" daily digest, and an operator utilization dashboard. Same DynamoDB+DSQL split; DSQL just does a heavier analytics job. See [`B2B_OUTLINE.md`](./B2B_OUTLINE.md).

## Could we run *this weekend's* festival on it?
Yes, with the [`DEPLOYMENT_READINESS.md`](./DEPLOYMENT_READINESS.md) checklist closed: go-live Stripe keys, rate-limiting + media moderation (the one real pre-public gate), a synthetic load pass on WS fan-out, and removal policies flipped to `RETAIN`. The infrastructure itself — serverless, no fixed capacity, one `cdk deploy` per environment — is built to be handed to an operator, not babysat.
