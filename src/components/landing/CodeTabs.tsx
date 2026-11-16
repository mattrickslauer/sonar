"use client";

import { useId, useState } from "react";
import CopyButton from "./CopyButton";

// curl / fetch switcher for one quickstart step.
export default function CodeTabs({
  tabs,
}: {
  tabs: { label: string; code: string }[];
}) {
  const [active, setActive] = useState(0);
  const id = useId();
  const current = tabs[active];
  return (
    <div className="lp-code">
      <div className="lp-code-bar">
        <div role="tablist" aria-label="Language" className="lp-tabs">
          {tabs.map((t, i) => (
            <button
              key={t.label}
              type="button"
              role="tab"
              id={`${id}-tab-${i}`}
              aria-selected={i === active}
              aria-controls={`${id}-panel`}
              className="lp-tab"
              onClick={() => setActive(i)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <CopyButton text={current.code} />
      </div>
      <pre
        tabIndex={0}
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-tab-${active}`}
      >
        <code>{current.code}</code>
      </pre>
    </div>
  );
}
