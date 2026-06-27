// "Ask the place" — answers a free-text question about a place using Claude
// Haiku 4.5 on **Amazon Bedrock**, grounded strictly in the live waypoints the
// caller can currently see. The Bedrock client authenticates with the same
// SONAR_-prefixed IAM identity the DynamoDB / DSQL / S3 clients use (no separate
// API key), so the AI runs inside the same AWS account as the data layer. Any
// failure (no credentials, model-access not enabled, API error, empty
// completion) degrades to a deterministic local synthesis so the interaction
// always returns a real, grounded answer.
import AnthropicBedrock from "@anthropic-ai/bedrock-sdk";
import { channelMeta } from "@/lib/channels";
import { rankWaypoints, synthesizeAnswer } from "@/lib/ask-synth";
import { Waypoint } from "@/lib/waypoints";

const REGION = process.env.SONAR_REGION ?? process.env.AWS_REGION ?? "us-east-1";
// Bedrock model id. Haiku 4.5 is served through a cross-region inference
// profile; "us." pins routing to US regions (co-located with the rest of the
// stack in us-east-1). Override with SONAR_BEDROCK_MODEL (e.g. a "global."
// profile) without a code change.
const MODEL =
  process.env.SONAR_BEDROCK_MODEL ??
  "us.anthropic.claude-haiku-4-5-20251001-v1:0";
const MAX_WAYPOINTS = 12; // bound the prompt: most-prominent signals only
const MAX_TEXT = 140; // truncate each drop so a single loud post can't blow the budget

const accessKeyId = process.env.SONAR_AWS_ACCESS_KEY_ID;
const secretAccessKey = process.env.SONAR_AWS_SECRET_ACCESS_KEY;

let client: AnthropicBedrock | null = null;
function getClient(): AnthropicBedrock | null {
  if (!accessKeyId || !secretAccessKey) return null;
  if (!client) {
    client = new AnthropicBedrock({
      awsAccessKey: accessKeyId,
      awsSecretKey: secretAccessKey,
      awsSessionToken: process.env.SONAR_AWS_SESSION_TOKEN,
      awsRegion: REGION,
    });
  }
  return client;
}

export function askConfigured(): boolean {
  return !!(accessKeyId && secretAccessKey);
}

export interface AskResult {
  answer: string;
  source: "model" | "fallback";
}

export async function askPlace(opts: {
  question: string;
  place: string;
  waypoints: Waypoint[];
}): Promise<AskResult> {
  const { question, place } = opts;
  const waypoints = rankWaypoints(opts.waypoints, MAX_WAYPOINTS);

  const api = getClient();
  if (!api) return { answer: synthesizeAnswer(waypoints), source: "fallback" };

  const signals = waypoints
    .map((w) => {
      const text = w.text.length > MAX_TEXT ? `${w.text.slice(0, MAX_TEXT)}…` : w.text;
      return `- [${channelMeta(w.channel).label}] ${text} (${w.minutesAgo}m ago, ${w.love} loves)`;
    })
    .join("\n");

  const system =
    `You are the ambient voice of "${place}", speaking for the place itself based ` +
    `only on the live signals people have dropped here in the last 24 hours. Answer ` +
    `the question in 1-3 short sentences, grounded strictly in the signals below. Be ` +
    `specific and quote what people said when it helps. If the signals don't cover the ` +
    `question, say it's quiet on that. Never invent details. No preamble.`;

  try {
    const resp = await api.messages.create({
      model: MODEL,
      max_tokens: 300,
      system,
      messages: [
        {
          role: "user",
          content: `Live signals at ${place}:\n${signals || "(none in the last 24h)"}\n\nQuestion: ${question}`,
        },
      ],
    });
    const answer = resp.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (!answer) return { answer: synthesizeAnswer(waypoints), source: "fallback" };
    return { answer, source: "model" };
  } catch (err) {
    console.error("askPlace: Bedrock call failed; using local synthesis", err);
    return { answer: synthesizeAnswer(waypoints), source: "fallback" };
  }
}
