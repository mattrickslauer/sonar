import CopyButton from "./CopyButton";

// A scroll-in-place code block. Long lines scroll inside the block, never the page.
export default function CodeBlock({
  code,
  label,
  copy = true,
}: {
  code: string;
  label?: string;
  copy?: boolean;
}) {
  return (
    <div className="lp-code">
      {(label || copy) && (
        <div className="lp-code-bar">
          <span>{label}</span>
          {copy && <CopyButton text={code} />}
        </div>
      )}
      <pre tabIndex={0}>
        <code>{code}</code>
      </pre>
    </div>
  );
}
