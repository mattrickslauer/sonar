# Sonar — H0 Hackathon submission kit

Everything needed to submit **Sonar** to [H0: Hack the Zero Stack](https://h01.devpost.com) — and to argue, to a panel of AWS Database judges, that the database is the centerpiece.

> **Track 3 · Million-scale Global App** · Live at **https://mysonar.zone** · **DynamoDB + Aurora DSQL** on Vercel.

## What's here

| File | What it's for |
|---|---|
| [`DEVPOST.md`](./DEVPOST.md) | The full text description — paste straight into Devpost fields. States the AWS DBs used, problem/who/why, how we built it. |
| [`VIDEO_SCRIPT.md`](./VIDEO_SCRIPT.md) | Shot-by-shot **demo video script (≤ 3:00)** with timecodes, narration, and a footage checklist. |
| [`DECK.html`](./DECK.html) | **Self-contained pitch + technical deck.** Open in any browser (arrows/space to navigate). On-brand dark radar theme. `Ctrl/Cmd+P` → Save as PDF for Devpost (one slide per page). |
| [`USE_CASE.md`](./USE_CASE.md) | A concrete, deployable real-world scenario (30k-person festival) → the "Impact & Real-world Applicability" story. |
| [`DEPLOYMENT_READINESS.md`](./DEPLOYMENT_READINESS.md) | Honest "can we ship this for real right now?" assessment + the exact gap to a paid go-live. |
| [`SUBMISSION_CHECKLIST.md`](./SUBMISSION_CHECKLIST.md) | Devpost field-by-field checklist + which DB screenshots to capture. |
| [`B2B_OUTLINE.md`](./B2B_OUTLINE.md) | Stub for an optional second entry — **Sonar for Work** (Track 2, B2B). |

Brand assets (logo, colors, type, the image-gen prompt pack) live in [`../brand/`](../brand).

## The one-sentence pitch
> A live radar of what's happening around you right now — ephemeral, crowd-curated, conversational — on a deliberately polyglot AWS data layer: **DynamoDB** for the high-write radar, **Aurora DSQL** for the relational record.

## The three lines that win the room
1. **"'Likes buy time' is an atomic TTL update — the marquee feature is the database."**
2. **"A geofence + a 24-hour window mean the data model replaces the vector database."**
3. **"It's live at mysonar.zone; a new environment is one `cdk deploy`. No fixed capacity, no idle compute."**

## Suggested order of operations to submit
1. Open `DECK.html`, present/refine, export to PDF.
2. Shoot the video from `VIDEO_SCRIPT.md` (record the **like → timer jump** shot first).
3. Capture the AWS console screenshots (`SUBMISSION_CHECKLIST.md`).
4. Paste `DEVPOST.md` into Devpost; add Vercel link + Team ID; attach diagram + screenshots.
5. Walk the final polish pass in `SUBMISSION_CHECKLIST.md`.
