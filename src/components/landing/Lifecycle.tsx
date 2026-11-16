// The ephemeral lifecycle: a 24 h ring that drains, gets pushed back +5 min
// by each like, beside the one thing that never drains: a sponsored pin.

const R = 52;
const C = 2 * Math.PI * R; // ≈ 326.7, mirrored in landing.css keyframes

export default function Lifecycle() {
  return (
    <div className="lp-life">
      <figure className="lp-life-item">
        <svg viewBox="0 0 140 140" className="lp-life-svg" aria-hidden="true">
          <circle cx="70" cy="70" r={R} className="lp-life-track" />
          <circle
            cx="70"
            cy="70"
            r={R}
            className="lp-life-drain"
            strokeDasharray={C}
            transform="rotate(-90 70 70)"
          />
          <circle cx="70" cy="70" r="5" className="lp-life-dot" />
          <text x="70" y="98" textAnchor="middle" className="lp-life-read">
            24 h
          </text>
          <text x="70" y="44" textAnchor="middle" className="lp-life-bump">
            +5 min
          </text>
        </svg>
        <figcaption>
          <strong>Every post fades.</strong> 24 hours by default, as little as
          15 minutes. When the ring runs out, the post is gone from every feed.
        </figcaption>
      </figure>

      <figure className="lp-life-item">
        <svg viewBox="0 0 140 140" className="lp-life-svg" aria-hidden="true">
          <circle cx="70" cy="70" r={R} className="lp-life-track" />
          <circle
            cx="70"
            cy="70"
            r={R}
            className="lp-life-kept"
            strokeDasharray={C}
            transform="rotate(-90 70 70)"
          />
          <g className="lp-life-hearts">
            <path d="M70 66c-4-5-12-3-12 3 0 5 7 9 12 13 5-4 12-8 12-13 0-6-8-8-12-3z" />
          </g>
        </svg>
        <figcaption>
          <strong>Each like buys 5 minutes.</strong> Uncapped, one per user per
          post. Take the like back and the minutes go with it.
        </figcaption>
      </figure>

      <figure className="lp-life-item">
        <svg viewBox="0 0 140 140" className="lp-life-svg" aria-hidden="true">
          <circle cx="70" cy="70" r={R} className="lp-life-perm" />
          <rect
            x="62"
            y="62"
            width="16"
            height="16"
            transform="rotate(45 70 70)"
            className="lp-life-pin"
          />
        </svg>
        <figcaption>
          <strong>Only sponsors are permanent.</strong>{" "}
          <code>lifespan: &quot;permanent&quot;</code> plus a{" "}
          <code>sponsor</code> label. Use it for drops, offers, landmarks.
        </figcaption>
      </figure>
    </div>
  );
}
