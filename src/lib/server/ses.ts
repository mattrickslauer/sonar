// Server-only: send the OTP email via Amazon SES v2.
//
// Requires SONAR_SES_SENDER (a verified SES identity, e.g. "Sonar
// <login@yourdomain>"). When unset, we DON'T fail — we log the code to the
// server console so local dev / unconfigured demos still work. Reuses the
// SONAR_AWS_* credentials.
import {
  SESv2Client,
  SendEmailCommand,
} from "@aws-sdk/client-sesv2";

const REGION = process.env.SONAR_REGION ?? process.env.AWS_REGION ?? "us-east-1";
const SENDER = process.env.SONAR_SES_SENDER;

const accessKeyId = process.env.SONAR_AWS_ACCESS_KEY_ID;
const secretAccessKey = process.env.SONAR_AWS_SECRET_ACCESS_KEY;

let client: SESv2Client | undefined;
function getClient(): SESv2Client {
  if (!client) {
    client = new SESv2Client({
      region: REGION,
      ...(accessKeyId && secretAccessKey
        ? { credentials: { accessKeyId, secretAccessKey } }
        : {}),
    });
  }
  return client;
}

/** True when SES is configured (a verified sender is set). */
export function emailConfigured(): boolean {
  return Boolean(SENDER);
}

/** Send a sign-in code. No-op-with-log when SES isn't configured. */
export async function sendOtpEmail(to: string, code: string): Promise<void> {
  if (!SENDER) {
    // Dev / unconfigured: surface the code in function logs instead of failing.
    console.log(`[otp] code for ${to}: ${code} (SONAR_SES_SENDER unset — not emailed)`);
    return;
  }
  await getClient().send(
    new SendEmailCommand({
      FromEmailAddress: SENDER,
      Destination: { ToAddresses: [to] },
      Content: {
        Simple: {
          Subject: { Data: `Your Sonar sign-in code: ${code}` },
          Body: {
            Text: {
              Data: `Your Sonar sign-in code is ${code}. It expires in 10 minutes.\n\nIf you didn't request this, you can ignore this email.`,
            },
          },
        },
      },
    }),
  );
}
