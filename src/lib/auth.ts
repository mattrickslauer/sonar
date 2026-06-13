// Client-side auth helpers: the anonymous device id and the sign-in calls.
// The session itself is an httpOnly cookie the browser sends automatically — JS
// never reads or stores a token.

const ANON_KEY = "sonar_uid";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The persistent anonymous account id (a UUID = accounts.id) in localStorage.
 * Pre-UUID ids ("u_xxxx") from older builds are replaced with a fresh UUID;
 * their old anonymous drops are ephemeral (24h TTL) and simply expire.
 * Returns "" if storage is unavailable (the API then needs a session).
 */
export function loadAnonId(): string {
  try {
    let id = localStorage.getItem(ANON_KEY);
    if (!id || !UUID_RE.test(id)) {
      id = crypto.randomUUID();
      localStorage.setItem(ANON_KEY, id);
    }
    return id;
  } catch {
    return "";
  }
}

export interface Account {
  id: string;
  displayName: string;
}

/** The currently signed-in account, or null. Reads the session cookie. */
export async function fetchMe(): Promise<Account | null> {
  try {
    const res = await fetch("/api/auth/me", { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    return data.account ?? null;
  } catch {
    return null;
  }
}

/** Request an email OTP. Returns true if a code was sent (or throttled-but-ok). */
export async function startOtp(email: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch("/api/auth/otp/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (res.ok) return { ok: true };
  const data = await res.json().catch(() => null);
  return { ok: false, error: data?.error ?? `error ${res.status}` };
}

/** Verify the OTP and claim/sign-in. On success the session cookie is set. */
export async function verifyOtp(
  email: string,
  code: string,
  anonId: string,
): Promise<{ account: Account; claimed: boolean } | { error: string }> {
  const res = await fetch("/api/auth/otp/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, code, anonId }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) return { error: data?.error ?? `error ${res.status}` };
  return data as { account: Account; claimed: boolean };
}

/** Exchange a Google ID token for a Sonar session (claim/sign-in). */
export async function googleSignIn(
  credential: string,
  anonId: string,
): Promise<{ account: Account; claimed: boolean } | { error: string }> {
  const res = await fetch("/api/auth/google", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ credential, anonId }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) return { error: data?.error ?? `error ${res.status}` };
  return data as { account: Account; claimed: boolean };
}

/** Clear the session. */
export async function logout(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" });
}

/** The Google client id for one-tap (build-time public env). */
export const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
