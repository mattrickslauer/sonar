# Sonar Infrastructure (CDK)

AWS CDK (TypeScript) for the Sonar data layer. Implements the design in
[`../docs/data-model.md`](../docs/data-model.md). Region: **us-east-1**.

## What this stack creates

- **DynamoDB `sonar`** — single table, on-demand, `ttl` TTL, `NEW_AND_OLD_IMAGES`
  stream, plus **GSI1** for the reverse lookups.
- **Aurora DSQL cluster** — relational system-of-record. The schema (DDL) is in
  the data-model doc and is applied as a separate migration (not by CDK).
- **Stream consumers** (`lambda/`): `fanout` (INSERT → push to subscribers) and
  `meter` (INSERT `USAGE#…` → DSQL rollups). Current stubs — they log and document
  the real work as TODOs. There is **no promotion consumer**: permanence is sponsored,
  not stream-driven. (Note: **likes extend a drop's `ttl` in-place** via the love API —
  `ADD ttl 300` per human like — and **sponsored permanent pins are created with a
  far-future `ttl`**; neither path is a stream consumer.)
- **Bot tick** — EventBridge rule (1 min) → `bot-tick` Lambda that tops up quiet
  cells with templated bot waypoints off the `PRESENCE` items.

## Commands

```bash
npm install
npm run synth     # cdk synth — validate / inspect the template
npm run diff      # cdk diff against the deployed stack
npm run deploy    # cdk deploy (requires AWS creds + one-time `cdk bootstrap`)
```

## Notes

- **EventBridge cadence:** `rate()` minimum is 1 minute. The data model's ~45s
  bot cadence needs the handler to self-reschedule or a Step Functions Wait loop.
- **DSQL DDL** is applied out-of-band (e.g. a migration Lambda or psql) after the
  cluster is up; CDK only provisions the cluster.
- **Removal policy** on the table is `DESTROY` for the hackathon — switch to
  `RETAIN` for anything real.
