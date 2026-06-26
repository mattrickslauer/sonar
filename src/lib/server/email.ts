// Server-only: send transactional email via ZeptoMail's SMTP relay (nodemailer).
//
// Requires SONAR_ZEPTO_TOKEN (the ZeptoMail "Send Mail" token — used as the SMTP
// password, with the literal username "emailapikey"). The sender defaults to
// "Sonar <sonar@agfarms.dev>" and can be overridden with SONAR_MAIL_FROM.
//
// When the token is unset we DON'T fail — we log the code to the server console
// so local dev / unconfigured demos still work.
import nodemailer, { type Transporter } from "nodemailer";

const TOKEN = process.env.SONAR_ZEPTO_TOKEN;
const FROM = process.env.SONAR_MAIL_FROM ?? "Sonar <sonar@agfarms.dev>";

let transport: Transporter | undefined;
function getTransport(): Transporter {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: "smtp.zeptomail.com",
      port: 587,
      auth: { user: "emailapikey", pass: TOKEN },
    });
  }
  return transport;
}

/** True when ZeptoMail is configured (a send token is set). */
export function emailConfigured(): boolean {
  return Boolean(TOKEN);
}

/** Send a sign-in code. No-op-with-log when ZeptoMail isn't configured. */
export async function sendOtpEmail(to: string, code: string): Promise<void> {
  if (!TOKEN) {
    // Dev / unconfigured: surface the code in function logs instead of failing.
    console.log(`[otp] code for ${to}: ${code} (SONAR_ZEPTO_TOKEN unset — not emailed)`);
    return;
  }
  await getTransport().sendMail({
    from: FROM,
    to,
    subject: `Your Sonar sign-in code: ${code}`,
    text: `Your Sonar sign-in code is ${code}. It expires in 10 minutes.\n\nIf you didn't request this, you can ignore this email.`,
  });
}
