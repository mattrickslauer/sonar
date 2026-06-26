// POST /api/ask { question, place?, waypoints[] }
// "Ask the place" — answers a free-text question grounded in the caller's
// currently-visible waypoints, via Claude Haiku (see @/lib/server/ask). Always
// 200 with an { answer, source } payload: the model when configured, otherwise
// a deterministic local synthesis, so the bar never dead-ends.
import { askPlace } from "@/lib/server/ask";
import { Waypoint } from "@/lib/waypoints";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_QUESTION = 300;

function asWaypoints(v: unknown): Waypoint[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (w): w is Waypoint =>
      !!w &&
      typeof w === "object" &&
      typeof (w as Waypoint).text === "string" &&
      typeof (w as Waypoint).channel === "string" &&
      typeof (w as Waypoint).minutesAgo === "number" &&
      typeof (w as Waypoint).love === "number",
  );
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const question =
    typeof body?.question === "string" ? body.question.trim().slice(0, MAX_QUESTION) : "";
  if (!question) return Response.json({ error: "question is required" }, { status: 400 });

  const place =
    typeof body?.place === "string" && body.place ? body.place.slice(0, 80) : "here";
  const waypoints = asWaypoints(body?.waypoints);

  const result = await askPlace({ question, place, waypoints });
  return Response.json(result);
}
