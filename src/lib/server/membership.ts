// Server-only: private-channel membership. DSQL `channel_members` is the
// SYSTEM-OF-RECORD (authoritative for the REST guard); a DynamoDB mirror
// (PK=CH#<id> / SK=MEMBER#<accountId>) is the fast read cache the WebSocket
// authorizer consults on $connect. addMember/removeMember keep both in sync —
// DSQL first (the source of truth), then the DynamoDB cache. See
// infra/sql/007_channel_members.sql.
import { PutCommand, DeleteCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE } from "@/lib/server/dynamo";
import { query } from "@/lib/server/dsql";

export type ChannelRole = "owner" | "member";

const SERIALIZATION_FAILURE = "40001";

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if ((err as { code?: string })?.code === SERIALIZATION_FAILURE) continue;
      throw err;
    }
  }
  throw lastErr;
}

/** Write the DynamoDB membership-cache row the WS authorizer reads. Durable (no
 *  TTL). GSI1 reverse key supports "channels this user is in" rebuilds. */
async function putMemberCache(channelId: string, accountId: string, role: ChannelRole): Promise<void> {
  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: {
      PK: `CH#${channelId}`,
      SK: `MEMBER#${accountId}`,
      GSI1PK: `USER#${accountId}`,
      GSI1SK: `CHMEMBER#${channelId}`,
      channelId,
      accountId,
      role,
      createdAt: Date.now(),
    },
  }));
}

async function deleteMemberCache(channelId: string, accountId: string): Promise<void> {
  await ddb.send(new DeleteCommand({
    TableName: TABLE,
    Key: { PK: `CH#${channelId}`, SK: `MEMBER#${accountId}` },
  }));
}

/** Add (or re-assert) a member. DSQL first (authoritative, idempotent via the
 *  unique index), then the DynamoDB cache. */
export async function addMember(
  channelId: string,
  accountId: string,
  role: ChannelRole = "member",
): Promise<void> {
  await withRetry(async () => {
    await query(
      `INSERT INTO channel_members (channel_id, account_id, role)
         VALUES ($1, $2, $3)
         ON CONFLICT (channel_id, account_id) DO UPDATE SET role = $4`,
      [channelId, accountId, role, role],
    );
  });
  await putMemberCache(channelId, accountId, role);
}

/** Remove a member from both stores. */
export async function removeMember(channelId: string, accountId: string): Promise<void> {
  await withRetry(async () => {
    await query(
      `DELETE FROM channel_members WHERE channel_id = $1 AND account_id = $2`,
      [channelId, accountId],
    );
  });
  await deleteMemberCache(channelId, accountId).catch(() => {});
}

export interface MemberRow {
  accountId: string;
  role: ChannelRole;
  /** The member's display name (LEFT JOINed from accounts; null if the account
   *  row is somehow absent). Anonymous members default to "you" until they set
   *  one on join or claim the account. */
  displayName: string | null;
  /** The member's handle (= the account UUID until claimed). */
  handle: string | null;
}

/** All members of a channel (DSQL authoritative), with display names for the
 *  owner's manage UI. LEFT JOIN so a member with no accounts row still lists. */
export async function listMembers(channelId: string): Promise<MemberRow[]> {
  const res = await query<MemberRow>(
    `SELECT m.account_id AS "accountId", m.role,
            a.display_name AS "displayName", a.handle
       FROM channel_members m
       LEFT JOIN accounts a ON a.id = m.account_id
      WHERE m.channel_id = $1
      ORDER BY m.created_at`,
    [channelId],
  );
  return res.rows;
}

/** Whether an account is a member of a channel — the REST guard's check
 *  (DSQL authoritative, not the DynamoDB cache). */
export async function isMember(channelId: string, accountId: string): Promise<boolean> {
  const res = await query<{ one: number }>(
    `SELECT 1 AS one FROM channel_members WHERE channel_id = $1 AND account_id = $2 LIMIT 1`,
    [channelId, accountId],
  );
  return res.rows.length > 0;
}

/** Private channel ids this account belongs to (for the dynamic channel list). */
export async function listMyPrivateChannelIds(accountId: string): Promise<string[]> {
  const res = await query<{ channelId: string }>(
    `SELECT channel_id AS "channelId" FROM channel_members WHERE account_id = $1`,
    [accountId],
  );
  return res.rows.map((r) => r.channelId);
}

/** Cascade-remove every member of a channel (the unlock-on-cancel path). Returns
 *  the removed account ids so the caller can close their live sockets. */
export async function removeAllMembers(channelId: string): Promise<string[]> {
  const members = await listMembers(channelId);
  await withRetry(async () => {
    await query(`DELETE FROM channel_members WHERE channel_id = $1`, [channelId]);
  });
  await Promise.all(
    members.map((m) => deleteMemberCache(channelId, m.accountId).catch(() => {})),
  );
  return members.map((m) => m.accountId);
}

/**
 * Mirror a channel's privacy flag to DynamoDB so the WebSocket authorizer — a
 * Lambda with no DSQL client — can tell private channels from public ones on the
 * hot $connect path without a relational round-trip. Item: PK=CHANNEL#<id> /
 * SK=META. Written once at channel creation; the authorizer GetItems it and
 * requires a MEMBER# row only when isPrivate is true.
 */
export async function putChannelMeta(channelId: string, isPrivate: boolean): Promise<void> {
  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: { PK: `CHANNEL#${channelId}`, SK: "META", channelId, isPrivate },
  }));
}

/** Connection ids currently subscribed to a channel (for closing sockets on
 *  revoke/cancel). Reads the CONN#<channel> partition the WS layer writes. */
export async function connectionsForChannel(channelId: string): Promise<string[]> {
  const res = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: "PK = :pk AND begins_with(SK, :cid)",
    ExpressionAttributeValues: { ":pk": `CONN#${channelId}`, ":cid": "CID#" },
  }));
  return (res.Items ?? []).map((it) => String(it.SK).slice("CID#".length));
}
