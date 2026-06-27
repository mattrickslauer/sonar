# H0 submission checklist — Sonar

Devpost deadline: **Jun 29, 2026 @ 8:00pm GMT-4**. Work top to bottom.

## Required by the rules
- [ ] **Text description** — paste from [`DEVPOST.md`](./DEVPOST.md). Must state **which AWS Database** you used → DynamoDB (primary) + Aurora DSQL.
- [ ] **Demo video, < 3:00, public on YouTube** — script in [`VIDEO_SCRIPT.md`](./VIDEO_SCRIPT.md). Must cover: problem · for whom · why · footage of the working app · which AWS Databases.
- [ ] **Published Vercel project link** — `https://mysonar.zone` *(and the Vercel-generated project URL)*.
- [ ] **Vercel Team ID** — Vercel → Settings → General → copy **Team ID**. Paste into Devpost.
- [ ] **Architecture diagram** — `ARCHITECTURE_DIAGRAM.pdf` (repo root) or export a frame from `DECK.html`. Must show how the app connects to back-end components.
- [ ] **Screenshot proving AWS Database usage** — see capture list below.
- [ ] **Choose track** — Track **3 · Million-scale Global App** (Sonar consumer).

## Screenshots to capture (proof of DB usage)
- [ ] AWS Console → **DynamoDB → Tables → `sonar`** (us-east-1): show the table, on-demand capacity, TTL enabled, and Streams enabled. *Best single proof.*
- [ ] AWS Console → **Aurora DSQL → cluster** (us-east-1): show the cluster status/endpoint.
- [ ] *(Optional, strong)* DynamoDB → Explore items: show a real waypoint item with `PK = CH#...#GEO#...` and a `ttl` attribute.
- [ ] *(Optional)* Vercel → Storage/Integrations or env config showing the AWS connection.
- [ ] Redact account IDs / secrets in every screenshot.

## Bonus points (do at least one)
- [ ] Publish a build write-up (dev.to / Medium / LinkedIn / builder.aws.com) on building Sonar with DynamoDB + Aurora DSQL + Vercel. Include the line *"created for the purposes of entering the H0 hackathon"* and hashtag **#H0Hackathon**. Outline ready in this folder if you want it expanded.

## Pre-submit polish pass
- [ ] mysonar.zone loads fast and the radar works on a phone (judges will open it).
- [ ] "Ask the place" returns a real answer (Bedrock model access enabled in us-east-1).
- [ ] At least a few seeded waypoints visible so the radar isn't empty when judges open it.
- [ ] Sponsored pin visible (proves monetization is real).
- [ ] Brand consistent: favicon, OG card (share the link in Slack/Discord to confirm the card renders), title.

## Field-to-source map
| Devpost field | Source |
|---|---|
| Inspiration / What it does / How we built it / Challenges / What's next | `DEVPOST.md` |
| "Built with" tags | next.js, react, typescript, **amazon-dynamodb**, **aurora-dsql**, vercel, aws-lambda, api-gateway, amazon-s3, amazon-cloudfront, amazon-bedrock, stripe, mapbox |
| Video link | YouTube (from `VIDEO_SCRIPT.md` shoot) |
| Vercel link + Team ID | Vercel dashboard |
| Architecture diagram | `ARCHITECTURE_DIAGRAM.pdf` / `DECK.html` |
| Database screenshot | AWS console captures above |
