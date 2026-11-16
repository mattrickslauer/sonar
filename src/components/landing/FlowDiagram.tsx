// Hero diagram: your app sits above the line your users can see; Sonar runs
// beneath it and fans out to the engine's parts. Pure SVG + CSS animation
// (see landing.css, all motion is off under prefers-reduced-motion).

const CX = 180;
const CY = 300;

const parts = [
  { x: 60, y: 430, label: "Posts", sub: "text, photo, video, voice" },
  { x: 180, y: 430, label: "Media", sub: "upload tickets" },
  { x: 300, y: 430, label: "Moderation", sub: "photos checked first" },
  { x: 110, y: 505, label: "Likes buy time", sub: "+5 min each" },
  { x: 250, y: 505, label: "Sponsored pins", sub: "never expire" },
];

export default function FlowDiagram() {
  return (
    <svg
      className="lp-flow"
      viewBox="0 0 360 560"
      role="img"
      aria-labelledby="lp-flow-title lp-flow-desc"
    >
      <title id="lp-flow-title">How Sonar sits under your app</title>
      <desc id="lp-flow-desc">
        Your app, with your users and your brand, calls the Sonar API with a
        server-side key. Your users never see Sonar. Sonar handles posts, media
        uploads, moderation, likes that buy time and sponsored pins.
      </desc>

      {/* What your users see */}
      <rect x="70" y="24" width="220" height="86" rx="14" className="lp-flow-app" />
      <text x={CX} y="60" textAnchor="middle" className="lp-flow-h">
        Your app
      </text>
      <text x={CX} y="84" textAnchor="middle" className="lp-flow-s">
        your users, your sign-in, your brand
      </text>

      <line x1="8" y1="150" x2="352" y2="150" className="lp-flow-fold" />
      <text x="8" y="140" className="lp-flow-note">
        what your users see
      </text>
      <text x="352" y="170" textAnchor="end" className="lp-flow-note">
        invisible to them
      </text>

      {/* Request path */}
      <line x1={CX} y1="110" x2={CX} y2={CY - 72} className="lp-flow-wire lp-flow-wire-in" />
      <circle cx={CX} cy="0" r="3.5" className="lp-flow-packet" />
      <text x={CX + 10} y="205" className="lp-flow-note lp-mono">
        HTTPS + sk_live key
      </text>

      {/* Spokes to the engine parts */}
      {parts.map((p) => (
        <line
          key={p.label}
          x1={CX}
          y1={CY}
          x2={p.x}
          y2={p.y - 14}
          className="lp-flow-wire lp-flow-wire-out"
        />
      ))}

      {/* The radar */}
      <g className="lp-flow-radar">
        <circle cx={CX} cy={CY} r="70" className="lp-flow-disc" />
        <circle cx={CX} cy={CY} r="47" className="lp-flow-ring" />
        <circle cx={CX} cy={CY} r="24" className="lp-flow-ring" />
        <g className="lp-flow-sweep">
          <path
            d={`M ${CX} ${CY} L ${CX} ${CY - 70} A 70 70 0 0 1 ${CX + 49.5} ${CY - 49.5} Z`}
            fill="url(#lp-sweep-grad)"
          />
        </g>
        <circle cx={CX} cy={CY} r="10" className="lp-flow-ping" />
        <circle cx={CX} cy={CY} r="5" className="lp-flow-core" />
      </g>
      <text x={CX + 80} y={CY + 4} className="lp-flow-h lp-flow-h-sm">
        Sonar API
      </text>

      {parts.map((p) => (
        <g key={p.label}>
          <circle cx={p.x} cy={p.y - 14} r="5" className="lp-flow-node" />
          <text x={p.x} y={p.y + 8} textAnchor="middle" className="lp-flow-label">
            {p.label}
          </text>
          <text x={p.x} y={p.y + 25} textAnchor="middle" className="lp-flow-s">
            {p.sub}
          </text>
        </g>
      ))}

      <defs>
        <linearGradient id="lp-sweep-grad" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#34e3a0" stopOpacity="0.45" />
          <stop offset="1" stopColor="#34e3a0" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}
