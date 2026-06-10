import { isValidMediaKey, mediaConfigured, viewUrl } from "@/lib/server/media";

// Signs a short-lived GET — never cached (the presigned URL expires).
export const dynamic = "force-dynamic";

// GET /api/media/view?key=media/<channel>/<id>.<ext>
// → 307 redirect to a short-lived presigned S3 GET URL.
export async function GET(request: Request) {
  if (!mediaConfigured()) {
    return Response.json(
      { error: "media uploads are not configured" },
      { status: 503 },
    );
  }

  const key = new URL(request.url).searchParams.get("key");
  if (!key || !isValidMediaKey(key)) {
    return Response.json({ error: "invalid media key" }, { status: 400 });
  }

  try {
    const url = await viewUrl(key);
    return new Response(null, {
      status: 307,
      // Don't let the browser cache the 307 — the target presigned URL expires.
      headers: { Location: url, "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("viewUrl failed", err);
    const name = err instanceof Error ? err.name : "Error";
    return Response.json({ error: "could not sign media url", name }, { status: 500 });
  }
}
