"use client";

interface Props {
  locating: boolean;
  // null while we're still trying; otherwise the failure reason.
  error: "denied" | "unavailable" | "unsupported" | null;
  onRetry: () => void;
}

const MESSAGES: Record<NonNullable<Props["error"]>, { title: string; body: string }> = {
  denied: {
    title: "Location is blocked",
    body: "Sonar is a map of what's around you, so it can't start without your location. Enable location for this site in your browser settings, then try again.",
  },
  unavailable: {
    title: "Couldn't find you",
    body: "We couldn't pin your location. Check that location services are on and you have signal, then try again.",
  },
  unsupported: {
    title: "Location unsupported",
    body: "This browser can't share a location, so Sonar has nothing to map. Try opening Sonar in a different browser.",
  },
};

export default function LocationGate({ locating, error, onRetry }: Props) {
  const msg = error ? MESSAGES[error] : null;

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-7 bg-background px-9 text-center">
      {/* Sonar sweep — locating pulses, error state stays static */}
      <div className="relative flex h-28 w-28 items-center justify-center">
        <span className="absolute inset-0 rounded-full border border-sonar/25" />
        <span className="absolute inset-3 rounded-full border border-sonar/20" />
        {locating && (
          <>
            <span className="absolute inset-0 animate-ping rounded-full bg-sonar/10" />
            <span
              className="absolute inset-0 animate-spin rounded-full [animation-duration:1.6s]"
              style={{
                background:
                  "conic-gradient(from 0deg, rgba(52,227,160,0) 0deg, rgba(52,227,160,.35) 60deg, rgba(52,227,160,0) 120deg)",
              }}
            />
          </>
        )}
        <span className="relative h-4 w-4 rounded-full bg-sonar shadow-[0_0_18px_4px_#34e3a0]" />
      </div>

      <div className="flex flex-col gap-2">
        <h1 className="text-[15px] font-bold tracking-tight text-sonar">sonar</h1>
        <h2 className="text-[20px] font-semibold text-white">
          {locating ? "Finding you…" : msg?.title}
        </h2>
        <p className="mx-auto max-w-[19rem] text-[13.5px] leading-relaxed text-white/55">
          {locating
            ? "Sonar needs your location to show what's happening around you."
            : msg?.body}
        </p>
      </div>

      {!locating && (
        <button
          onClick={onRetry}
          className="rounded-full bg-sonar px-6 py-3 text-[14px] font-semibold text-[#04110c] shadow-lg shadow-sonar/30"
        >
          {error === "denied" ? "Try again" : "Enable location"}
        </button>
      )}
    </div>
  );
}
