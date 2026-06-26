// "Ask the place" — answers a free-text question about a place using Claude
// Haiku, grounded strictly in the live waypoints the caller can currently see.
// Mirrors the bot-tick Lambda's posture: the Anthropic key is optional, and any
// failure (no key, API error, empty completion) degrades to a deterministic
// local synthesis so the interaction always returns a real, grounded answer.
import Anthropic from "@anthropic-ai/sdk";
import { channelMeta } from "@/lib/channels";
import { rankWaypoints, synthesizeAnswer } from "@/lib/ask-synth";
import { Waypoint } from "@/lib/waypoints";

const MODEL = "claude-haiku-4-5";
const MAX_WAYPOINTS = 12; // bound the prompt: most-prominent signals only
const MAX_TEXT = 140; // truncate each drop so a single loud post can't blow the budget

let client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
  return client;
}

export function askConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
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
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (!answer) return { answer: synthesizeAnswer(waypoints), source: "fallback" };
    return { answer, source: "model" };
  } catch (err) {
    console.error("askPlace: Haiku call failed; using local synthesis", err);
    return { answer: synthesizeAnswer(waypoints), source: "fallback" };
  }
}
