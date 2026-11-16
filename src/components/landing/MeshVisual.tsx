// Sonar Mesh (coming soon): a post hops phone to phone over Bluetooth with
// no signal anywhere, until the last phone finds a connection and syncs.

const PHONES = [60, 190, 320, 450, 580];
const Y = 170;

export default function MeshVisual() {
  return (
    <svg
      className="lp-mesh-svg"
      viewBox="0 0 640 260"
      role="img"
      aria-labelledby="lp-mesh-title"
    >
      <title id="lp-mesh-title">
        A post passes from phone to phone over Bluetooth, then syncs to Sonar
        when the last phone gets signal
      </title>

      {/* Sonar, out of reach until the end */}
      <g className="lp-mesh-cloud">
        <circle cx="580" cy="38" r="20" className="lp-mesh-cloud-ring" />
        <circle cx="580" cy="38" r="6" className="lp-mesh-cloud-core" />
      </g>
      <line x1="580" y1="62" x2="580" y2={Y - 46} className="lp-mesh-uplink" />

      {/* Bluetooth hops */}
      {PHONES.slice(0, -1).map((x, i) => (
        <path
          key={x}
          d={`M ${x + 24} ${Y - 10} Q ${x + 65} ${Y - 60} ${PHONES[i + 1] - 24} ${Y - 10}`}
          className="lp-mesh-hop"
        />
      ))}

      {PHONES.map((x, i) => (
        <g key={x} className={`lp-mesh-phone lp-mesh-p${i + 1}`}>
          <rect x={x - 22} y={Y - 40} width="44" height="80" rx="9" className="lp-mesh-body" />
          <rect x={x - 17} y={Y - 32} width="34" height="60" rx="4" className="lp-mesh-screen" />
          {/* signal bars: struck through everywhere except the last phone at the end */}
          <g className={i === PHONES.length - 1 ? "lp-mesh-bars lp-mesh-bars-on" : "lp-mesh-bars"}>
            <rect x={x - 6} y={Y + 52} width="3" height="4" />
            <rect x={x - 1} y={Y + 49} width="3" height="7" />
            <rect x={x + 4} y={Y + 46} width="3" height="10" />
          </g>
          {i < PHONES.length - 1 && (
            <line x1={x - 9} y1={Y + 58} x2={x + 10} y2={Y + 44} className="lp-mesh-nosig" />
          )}
        </g>
      ))}

      {/* The post itself */}
      <g className="lp-mesh-carrier">
        <circle cx="0" cy="0" r="7" className="lp-mesh-post-ping" />
        <circle cx="0" cy="0" r="7" className="lp-mesh-post" />
      </g>
    </svg>
  );
}
