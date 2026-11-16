"use client";

import { useState } from "react";

// The only interactive bit on a code block: copy its text, confirm for 1.5 s.
export default function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="lp-copy"
      aria-label={copied ? "Copied" : "Copy code"}
      onClick={() => {
        navigator.clipboard?.writeText(text).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          },
          () => {},
        );
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
