// Server-only: send transactional email via Resend's HTTP API.
//
// Requires RESEND_API_KEY. The sender defaults to "Sonar <sonar@mattrickslauer.com>"
// and can be overridden with SONAR_EMAIL_FROM (the domain must be verified in
// Resend). The old SONAR_MAIL_FROM is deliberately not read: it still holds the
// ZeptoMail-era agfarms.dev sender, which Resend can't send from.
//
// When the key is unset we DON'T fail — we log the code to the server console
// so local dev / unconfigured demos still work.
import { resend } from "./resend";

const DEFAULT_FROM = "Sonar <sonar@mattrickslauer.com>";

/** True when Resend is configured (an API key is set). */
export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

/** Send a sign-in code. No-op-with-log when Resend isn't configured. */
export async function sendOtpEmail(
  to: string,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    // Dev / unconfigured: surface the code in function logs instead of failing.
    console.log(`[otp] code for ${to}: ${code} (RESEND_API_KEY unset — not emailed)`);
    return;
  }
  await resend(key, fetchImpl).send({
    from: process.env.SONAR_EMAIL_FROM || DEFAULT_FROM,
    to,
    subject: `Your Sonar sign-in code: ${code}`,
    text: `Your Sonar sign-in code is ${code}. It expires in 10 minutes.\n\nIf you didn't request this, you can ignore this email.`,
  });
}
