// Code shown on /landing. Every endpoint, field and limit here comes from
// docs/platform/api.md — keep the two in step when the API changes.

export const BASE_URL = "https://mysonar.zone/api/v1";

export const step1Curl = `# 1. Ask Sonar for an upload ticket (server-side, with your key)
TICKET=$(curl -s -X POST ${BASE_URL}/media \\
  -H "Authorization: Bearer $SONAR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "kind": "photo", "contentType": "image/jpeg" }')

# → 201 { "key": "tenants/puq/3f…a9.jpg", "url": "https://…s3…", "fields": { … } }

# Then POST the file to "url": every field in "fields" first, then "file".
# The ticket lasts 5 minutes and carries no key.
curl -X POST "$(echo "$TICKET" | jq -r .url)" \\
  $(echo "$TICKET" | jq -r '.fields | to_entries[] | "-F \\(.key)=\\(.value)"') \\
  -F "file=@photo.jpg"

echo "$TICKET" | jq -r .key   # → your mediaKey for step 2`;

export const step1Fetch = `// 1. Your server asks for a ticket…
const res = await fetch("${BASE_URL}/media", {
  method: "POST",
  headers: {
    Authorization: \`Bearer \${process.env.SONAR_KEY}\`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ kind: "photo", contentType: "image/jpeg" }),
});
const { key, url, fields } = await res.json();

// …and the browser (or your server) uploads with it.
// Every field in \`fields\` first, then \`file\`.
const form = new FormData();
for (const [name, value] of Object.entries(fields)) form.append(name, value);
form.append("file", photo);
await fetch(url, { method: "POST", body: form });`;

export const step2Curl = `# 2. Create the post, pinned to a place
curl -X POST ${BASE_URL}/posts \\
  -H "Authorization: Bearer $SONAR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "user": { "id": "citizen_42", "name": "Ana" },
    "channel": "claims",
    "kind": "photo",
    "text": "Sunday coffee at Café Tapiz",
    "lat": -53.1625, "lng": -70.9081,
    "place": "shop:cafe-tapiz",
    "mediaKey": "tenants/puq/3f…a9.jpg"
  }'

# → 201 { "post": Post }
# → 422 rejected_by_moderation (no post is created)`;

export const step2Fetch = `// 2. Create the post, pinned to a place
const res = await fetch("${BASE_URL}/posts", {
  method: "POST",
  headers: {
    Authorization: \`Bearer \${process.env.SONAR_KEY}\`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    user: { id: "citizen_42", name: "Ana" },
    channel: "claims",
    kind: "photo",
    text: "Sunday coffee at Café Tapiz",
    lat: -53.1625, lng: -70.9081,
    place: "shop:cafe-tapiz",
    mediaKey: key, // from step 1
  }),
});
if (res.status === 422) {
  const { error } = await res.json(); // rejected_by_moderation
}
const { post } = await res.json();`;

export const step3Curl = `# 3. Read the place's wall, newest first
curl "${BASE_URL}/posts?place=shop:cafe-tapiz" \\
  -H "Authorization: Bearer $SONAR_KEY"

# → 200 { "posts": Post[] }   (only live posts)`;

export const step3Fetch = `// 3. Read the place's wall, newest first
const res = await fetch(
  "${BASE_URL}/posts?place=shop:cafe-tapiz",
  { headers: { Authorization: \`Bearer \${process.env.SONAR_KEY}\` } },
);
const { posts } = await res.json(); // only live posts`;

export const authHeader = `Authorization: Bearer sk_live_YOUR_KEY`;

export const errorShape = `{ "error": { "code": "…", "message": "…" } }`;

export const mediaReq = `{ "kind": "photo", "contentType": "image/jpeg" }`;
export const mediaRes = `201 { "key": "tenants/puq/3f…a9.jpg", "url": "https://…s3…", "fields": { … } }`;

export const postReq = `{
  "user": { "id": "citizen_42", "name": "Ana" },
  "channel": "claims",
  "kind": "photo",
  "text": "Sunday coffee at Café Tapiz",
  "lat": -53.1625, "lng": -70.9081,
  "place": "shop:cafe-tapiz",
  "mediaKey": "tenants/puq/3f…a9.jpg",
  "lifespan": 86400,
  "meta": { "drop": "drp_9", "reward": 12 }
}`;
export const postRes = `201 { "post": Post }`;
export const moderationRes = `422 { error: { code: "rejected_by_moderation", labels: [...] } }`;

export const loveReq = `{ "user": { "id": "citizen_7" } }`;
export const loveRes = `200 { "love": 3, "counted": true, "expiresAt": 1763412345000 }`;

export const usageRes = `200 { "tenant": "puq", "hours": [{ "hour": "2026111614", "requests": 120, "posts": 9, "uploads": 9, "moderations": 9 }] }`;

export const postObject = `{
  "id": "wp_4dj8ex01JD3K…",
  "channel": "claims",
  "kind": "photo",
  "text": "Sunday coffee at Café Tapiz",
  "author": "Ana",
  "userId": "citizen_42",
  "lat": -53.1625, "lng": -70.9081,
  "place": "shop:cafe-tapiz",
  "createdAt": 1763300000000,
  "expiresAt": 1763386400000,
  "permanent": false,
  "sponsor": null,
  "love": 3,
  "loved": false,
  "mediaUrl": "https://…signed, valid 10 minutes…",
  "meters": 42,
  "meta": { "drop": "drp_9", "reward": 12 }
}`;
