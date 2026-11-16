import type { Metadata } from "next";
import Link from "next/link";
import "./landing.css";
import CodeBlock from "@/components/landing/CodeBlock";
import CodeTabs from "@/components/landing/CodeTabs";
import FlowDiagram from "@/components/landing/FlowDiagram";
import Lifecycle from "@/components/landing/Lifecycle";
import MeshVisual from "@/components/landing/MeshVisual";
import * as s from "@/components/landing/snippets";

// Public marketing + docs page for the Sonar Platform API. Content mirrors
// docs/platform/api.md, which is the source of truth.

const DESCRIPTION =
  "Sonar's engine as a service: place-anchored posts that fade in 24 hours, likes that buy them time, permanent sponsored pins, photo uploads with automatic moderation. Your users never see Sonar.";

export const metadata: Metadata = {
  title: "Platform",
  description: DESCRIPTION,
  alternates: { canonical: "/landing" },
  openGraph: {
    title: "Sonar Platform",
    description: DESCRIPTION,
    url: "/landing",
  },
  twitter: {
    title: "Sonar Platform",
    description: DESCRIPTION,
  },
};

const EARLY_ACCESS =
  "mailto:hello@mysonar.zone?subject=Sonar%20Platform%20early%20access";

const concepts: { term: string; body: React.ReactNode }[] = [
  {
    term: "Tenant",
    body: "Your app. Every post, like and file is scoped to one tenant and invisible to the others and to mysonar.zone.",
  },
  {
    term: "API key",
    body: (
      <>
        <code>sk_live_…</code>, server-side only. Identifies the tenant. Never
        ship it to a browser.
      </>
    ),
  },
  {
    term: "User",
    body: (
      <>
        Your user. You pass <code>user: {"{ id, name }"}</code>; Sonar trusts
        it, stores it scoped to your tenant, and never asks them to sign in.
      </>
    ),
  },
  {
    term: "Post",
    body: (
      <>
        A waypoint: text, photo, video or 15 s voice at a <code>lat</code>/
        <code>lng</code>, on a <code>channel</code>, optionally tied to a{" "}
        <code>place</code>.
      </>
    ),
  },
  {
    term: "Place",
    body: (
      <>
        Your own id for a spot (<code>shop:cafe-tapiz</code>,{" "}
        <code>stage:north</code>). Gives you a per-place feed: a photo wall.
      </>
    ),
  },
  {
    term: "Channel",
    body: (
      <>
        Your own topic slug (<code>claims</code>, <code>food</code>,{" "}
        <code>events</code>). Free-form, <code>[a-z0-9-]{"{1,32}"}</code>.
      </>
    ),
  },
  {
    term: "Lifespan",
    body: "Posts fade after 24 h by default (min 15 min). Every like adds 5 minutes, uncapped.",
  },
  {
    term: "Sponsored pin",
    body: (
      <>
        <code>lifespan: &quot;permanent&quot;</code> + a <code>sponsor</code>{" "}
        label: never expires. Use it for drops, offers, landmarks.
      </>
    ),
  },
];

type Endpoint = {
  id: string;
  method: string;
  path: string;
  summary: string;
  request?: string;
  response: string[];
  notes: React.ReactNode[];
};

const endpoints: Endpoint[] = [
  {
    id: "media",
    method: "POST",
    path: "/media",
    summary: "Get an upload ticket.",
    request: s.mediaReq,
    response: [s.mediaRes],
    notes: [
      <>
        POST the file as <code>multipart/form-data</code> to <code>url</code>{" "}
        with every field in <code>fields</code> first, then <code>file</code>.
        The ticket lasts 5 minutes.
      </>,
      <>
        Limits: photo 10 MB (<code>image/*</code>), video 50 MB (
        <code>video/*</code>), voice 10 MB (<code>audio/*</code>).
      </>,
      <>
        Your server can hand the ticket to your user&apos;s browser: it carries
        no key. Browser uploads are allowed from the origins on your tenant.
      </>,
    ],
  },
  {
    id: "create-post",
    method: "POST",
    path: "/posts",
    summary: "Create a post.",
    request: s.postReq,
    response: [s.postRes, s.moderationRes],
    notes: [
      <>
        <code>kind</code>: <code>text</code> | <code>photo</code> |{" "}
        <code>video</code> | <code>voice</code>; media kinds need a{" "}
        <code>mediaKey</code> from <code>POST /media</code>.
      </>,
      <>
        <code>text</code> ≤ 2,000 chars. <code>place</code> ≤ 64 chars{" "}
        <code>[A-Za-z0-9:._-]</code>. <code>meta</code> ≤ 2 KB of JSON,
        returned as-is.
      </>,
      <>
        <code>lifespan</code>: seconds, 900–86,400 (default 86,400), or{" "}
        <code>&quot;permanent&quot;</code> with{" "}
        <code>&quot;sponsor&quot;: &quot;Café Tapiz&quot;</code>.
      </>,
      <>
        Moderation: photos are checked (nudity, violence, gore, hate symbols)
        before the post exists. A rejected photo returns <code>422</code> and
        no post.
      </>,
    ],
  },
  {
    id: "read-posts",
    method: "GET",
    path: "/posts",
    summary: "Read a feed: a place wall or what's nearby.",
    response: ["200 { \"posts\": Post[] }"],
    notes: [
      <>
        <code>?place=shop:cafe-tapiz</code>: newest first.
      </>,
      <>
        <code>?lat=-53.16&amp;lng=-70.91&amp;radius=500</code>: nearest first,
        radius ≤ 1,800 m.
      </>,
      <>
        Optional: <code>channel=claims,food</code>, <code>limit</code> (≤ 100,
        default 50), <code>user=&lt;id&gt;</code> (adds <code>loved</code> to
        each post).
      </>,
      <>Only live posts are returned. Expired ones never show.</>,
    ],
  },
  {
    id: "one-post",
    method: "GET",
    path: "/posts/{id}",
    summary: "Read one post.",
    response: ["200 { \"post\": Post }"],
    notes: [],
  },
  {
    id: "delete-post",
    method: "DELETE",
    path: "/posts/{id}",
    summary: "Take a post down.",
    response: ["200 { \"deleted\": true }"],
    notes: [
      <>
        Delete is your takedown: a reported post, a reversed reward, a user
        who leaves.
      </>,
    ],
  },
  {
    id: "love",
    method: "POST / DELETE",
    path: "/posts/{id}/love",
    summary: "Like a post, or take the like back.",
    request: s.loveReq,
    response: [s.loveRes],
    notes: [
      <>
        One like per user per post. A like adds 5 minutes of life; removing it
        refunds them.
      </>,
    ],
  },
  {
    id: "usage",
    method: "GET",
    path: "/usage?days=30",
    summary: "See your usage, hour by hour.",
    response: [s.usageRes],
    notes: [],
  },
];

const errors = [
  ["401", "Missing, unknown or revoked key."],
  ["403", "Suspended tenant."],
  ["422", "rejected_by_moderation: the photo failed moderation; no post was created."],
  ["429", "Over the per-minute request budget (default 600). Comes with Retry-After."],
];

export default function LandingPage() {
  return (
    <div className="lp">
      <header className="lp-nav">
        <Link href="/landing" className="lp-brand" aria-label="Sonar Platform">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
            <circle cx="12" cy="12" r="3.5" fill="currentColor" />
          </svg>
          <span>Sonar</span>
          <span className="lp-brand-sub">Platform</span>
        </Link>
        <nav aria-label="Page" className="lp-nav-links">
          <a href="#how">How it works</a>
          <a href="#quickstart">Quickstart</a>
          <a href="#api">API</a>
          <a href="#pricing">Pricing</a>
        </nav>
        <a href={EARLY_ACCESS} className="lp-btn lp-btn-sm">
          Get early access
        </a>
      </header>

      <main>
        {/* 1. Hero */}
        <section className="lp-hero lp-wrap" aria-labelledby="lp-hero-h">
          <div className="lp-hero-copy">
            <h1 id="lp-hero-h">The place layer under your app.</h1>
            <p className="lp-lede">
              Sonar runs the part of your product that lives at a place: posts
              pinned to a spot that fade in 24 hours, likes that buy them time,
              permanent sponsored pins, photo uploads with automatic
              moderation.
            </p>
            <p className="lp-lede lp-lede-quiet">
              Your app keeps its own users, its own sign-in and its own brand.
              Like Stripe, Sonar stays underneath: your users never see the
              word &ldquo;Sonar&rdquo;.
            </p>
            <div className="lp-ctas">
              <a href={EARLY_ACCESS} className="lp-btn">
                Get early access
              </a>
              <a href="#api" className="lp-btn lp-btn-ghost">
                Read the API
              </a>
            </div>
            <p className="lp-base lp-mono">
              <span>Base URL</span> https://mysonar.zone/api/v1
            </p>
          </div>
          <div className="lp-hero-art">
            <FlowDiagram />
          </div>
        </section>

        {/* 2. Lifecycle */}
        <section id="how" className="lp-section lp-wrap" aria-labelledby="lp-how-h">
          <h2 id="lp-how-h">Nothing lasts unless someone keeps it alive</h2>
          <p className="lp-intro">
            Every post Sonar holds for you follows the same clock. The crowd
            decides what stays a little longer; only a sponsor makes something
            permanent.
          </p>
          <Lifecycle />
        </section>

        {/* 3. Concepts */}
        <section id="concepts" className="lp-section lp-wrap" aria-labelledby="lp-concepts-h">
          <h2 id="lp-concepts-h">Eight words to know</h2>
          <dl className="lp-concepts">
            {concepts.map((c) => (
              <div key={c.term}>
                <dt>{c.term}</dt>
                <dd>{c.body}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* 4. Quickstart */}
        <section id="quickstart" className="lp-section lp-wrap" aria-labelledby="lp-qs-h">
          <h2 id="lp-qs-h">Quickstart: a photo on a place&apos;s wall</h2>
          <p className="lp-intro">
            Three calls. Keep the key on your server; only the upload ticket
            ever reaches a browser.
          </p>
          <ol className="lp-steps">
            <li>
              <div className="lp-step-text">
                <h3>Get an upload ticket and send the photo</h3>
                <p>
                  <code>POST /media</code> returns a ticket that lasts 5
                  minutes. Upload the file to its <code>url</code> with every
                  field in <code>fields</code> first, then <code>file</code>.
                </p>
              </div>
              <CodeTabs
                tabs={[
                  { label: "curl", code: s.step1Curl },
                  { label: "fetch", code: s.step1Fetch },
                ]}
              />
            </li>
            <li>
              <div className="lp-step-text">
                <h3>Create the post</h3>
                <p>
                  <code>POST /posts</code> with your user, a channel, the
                  coordinates, a <code>place</code> and the{" "}
                  <code>mediaKey</code>. The photo is moderated before the post
                  exists.
                </p>
              </div>
              <CodeTabs
                tabs={[
                  { label: "curl", code: s.step2Curl },
                  { label: "fetch", code: s.step2Fetch },
                ]}
              />
            </li>
            <li>
              <div className="lp-step-text">
                <h3>Show the wall</h3>
                <p>
                  <code>GET /posts?place=</code> returns that place&apos;s live
                  posts, newest first.
                </p>
              </div>
              <CodeTabs
                tabs={[
                  { label: "curl", code: s.step3Curl },
                  { label: "fetch", code: s.step3Fetch },
                ]}
              />
            </li>
          </ol>
        </section>

        {/* 5. API reference */}
        <section id="api" className="lp-section lp-wrap" aria-labelledby="lp-api-h">
          <h2 id="lp-api-h">API reference</h2>

          <div className="lp-ref-basics">
            <div>
              <h3>Authentication</h3>
              <CodeBlock code={s.authHeader} />
              <p>
                Keys are stored hashed; Sonar shows a key once, when it is made.
              </p>
            </div>
            <div>
              <h3>Errors</h3>
              <p>Errors always have the same shape:</p>
              <CodeBlock code={s.errorShape} copy={false} />
              <table className="lp-errors">
                <tbody>
                  {errors.map(([code, text]) => (
                    <tr key={code}>
                      <th scope="row" className="lp-mono">
                        {code}
                      </th>
                      <td>{text}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="lp-endpoints">
            {endpoints.map((e) => (
              <article key={e.id} id={`api-${e.id}`} className="lp-endpoint">
                <header>
                  <h3 className="lp-mono">
                    <span className={`lp-method lp-method-${(e.method.match(/^[A-Z]+/)?.[0] ?? "").toLowerCase()}`}>
                      {e.method}
                    </span>{" "}
                    {e.path}
                  </h3>
                  <p>{e.summary}</p>
                </header>
                {e.notes.length > 0 && (
                  <ul className="lp-notes">
                    {e.notes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                )}
                <div className="lp-io">
                  {e.request && <CodeBlock label="Request body" code={e.request} />}
                  <CodeBlock label="Response" code={e.response.join("\n")} copy={false} />
                </div>
              </article>
            ))}
          </div>

          <article id="api-post-object" className="lp-endpoint lp-post-object">
            <header>
              <h3>The Post object</h3>
              <p>
                <code>meters</code> is present on nearby reads.{" "}
                <code>loved</code> is present when <code>user</code> is passed.{" "}
                <code>mediaUrl</code> is signed for 10 minutes: re-read a feed to
                refresh it.
              </p>
            </header>
            <CodeBlock label="Post" code={s.postObject} />
          </article>
        </section>

        {/* 6. Case study */}
        <section id="puq" className="lp-section lp-wrap" aria-labelledby="lp-puq-h">
          <h2 id="lp-puq-h">First customer: puq.city</h2>
          <p className="lp-intro">
            puq.city is a city guide for Punta Arenas, Chile. Its citizens claim
            a visit to a local shop with a photo, and that photo becomes part of
            the shop&apos;s public wall. Sonar is the wall; puq.city&apos;s
            users never see it.
          </p>
          <ol className="lp-case">
            <li>
              <h3>Scan the counter QR</h3>
              <p>A citizen scans the QR code at the shop&apos;s counter in puq.city.</p>
            </li>
            <li>
              <h3>Pass a location check</h3>
              <p>puq.city confirms they are standing at the shop.</p>
            </li>
            <li>
              <h3>Take a photo there</h3>
              <p>
                The photo goes up with an upload ticket from{" "}
                <code>POST /media</code> and is moderated before any post exists.
              </p>
            </li>
            <li>
              <h3>It lands on the shop&apos;s wall</h3>
              <p>
                <code>POST /posts</code> with{" "}
                <code>place: &quot;shop:cafe-tapiz&quot;</code>; the wall reads{" "}
                <code>GET /posts?place=shop:cafe-tapiz</code>.
              </p>
            </li>
          </ol>
          <p className="lp-aside">
            The citizen also earns a rebate in puq.city&apos;s own coin. That
            part is puq.city&apos;s, not Sonar&apos;s. A post&apos;s{" "}
            <code>meta</code> (up to 2 KB of JSON, returned as-is) is where an
            app can keep its own notes, like a reward id.
          </p>
        </section>

        {/* 7. Pricing */}
        <section id="pricing" className="lp-section lp-wrap" aria-labelledby="lp-price-h">
          <div className="lp-pricing">
            <div>
              <h2 id="lp-price-h">Pricing</h2>
              <p className="lp-intro">
                Usage-based, billed monthly per tenant. You pay for what you
                use, and you can see all of it at <code>GET /usage</code>.
              </p>
              <ul className="lp-meters">
                <li>Requests</li>
                <li>Posts</li>
                <li>Stored media</li>
                <li>Moderation checks</li>
              </ul>
            </div>
            <div className="lp-pricing-cta">
              <p>
                Sonar Platform is in early access. Partners are onboarded by
                hand: tell us what you&apos;re building.
              </p>
              <a href={EARLY_ACCESS} className="lp-btn">
                Get early access
              </a>
              <p className="lp-mono lp-small">hello@mysonar.zone</p>
            </div>
          </div>
        </section>

        {/* 8. Sonar Mesh */}
        <section id="mesh" className="lp-mesh" aria-labelledby="lp-mesh-h">
          <div className="lp-wrap">
            <p className="lp-soon">Coming soon</p>
            <h2 id="lp-mesh-h">Sonar Mesh: posts that travel without the internet</h2>
            <p className="lp-intro">
              A festival field, a ferry, the far end of Patagonia. Each phone
              carries the place&apos;s recent posts over Bluetooth and passes
              them to the next one it meets. When anyone gets back online, the
              mesh syncs to Sonar.
            </p>
            <div className="lp-mesh-stage">
              <MeshVisual />
            </div>
            <ol className="lp-mesh-legend">
              <li>A post is dropped with no signal.</li>
              <li>It hops phone to phone over Bluetooth.</li>
              <li>The first phone back online syncs it to Sonar.</li>
            </ol>
            <p className="lp-mesh-foot">
              Same API, same posts, no internet required.
            </p>
          </div>
        </section>
      </main>

      <footer className="lp-footer lp-wrap">
        <Link href="/">Open the Sonar app</Link>
        <a href={EARLY_ACCESS}>hello@mysonar.zone</a>
        <a href="#api">API reference</a>
      </footer>
    </div>
  );
}
