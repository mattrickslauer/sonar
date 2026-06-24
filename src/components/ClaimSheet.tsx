"use client";

import { useEffect, useRef, useState } from "react";
import {
  startOtp,
  verifyOtp,
  googleSignIn,
  GOOGLE_CLIENT_ID,
  type Account,
} from "@/lib/auth";

// --- Minimal Google Identity Services typings (no `any`) -------------------
interface GoogleCredentialResponse {
  credential?: string;
}
interface GoogleIdApi {
  initialize(config: {
    client_id: string;
    callback: (res: GoogleCredentialResponse) => void;
  }): void;
  renderButton(parent: HTMLElement, options: Record<string, unknown>): void;
}
interface GoogleNamespace {
  accounts: { id: GoogleIdApi };
}
declare global {
  interface Window {
    google?: GoogleNamespace;
  }
}

const GSI_SRC = "https://accounts.google.com/gsi/client";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESEND_COOLDOWN = 30; // seconds

interface Props {
  account: Account | null;
  anonId: string;
  onClose: () => void;
  onSignedIn: (account: Account) => void;
  onSignOut: () => void | Promise<void>;
  /** Open the permanent-waypoint management console (signed-in only). */
  onManage?: () => void;
  /** Open the private-channel management sheet (signed-in only). */
  onManageChannels?: () => void;
}

export default function ClaimSheet({
  account,
  anonId,
  onClose,
  onSignedIn,
  onSignOut,
  onManage,
  onManageChannels,
}: Props) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [signingOut, setSigningOut] = useState(false);

  const emailValid = EMAIL_RE.test(email.trim());
  const codeValid = /^\d{6}$/.test(code);

  // --- Google one-tap: keep the latest closure for the GSI callback, which is
  // registered once. Assigning a ref inside an effect (not render) is lint-safe.
  const googleRef = useRef<HTMLDivElement | null>(null);
  const handleGoogleRef = useRef<(res: GoogleCredentialResponse) => void>(() => {});
  const [googleReady, setGoogleReady] = useState(false);

  useEffect(() => {
    handleGoogleRef.current = async (res: GoogleCredentialResponse) => {
      if (!res.credential) return;
      setPending(true);
      setError(null);
      const result = await googleSignIn(res.credential, anonId);
      setPending(false);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      onSignedIn(result.account);
    };
  });

  // Inject + initialize GSI when relevant (claim view, configured).
  useEffect(() => {
    if (account || !GOOGLE_CLIENT_ID || step !== "email") return;
    let cancelled = false;

    const init = () => {
      if (cancelled || !window.google || !googleRef.current) return;
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (res) => handleGoogleRef.current(res),
      });
      window.google.accounts.id.renderButton(googleRef.current, {
        theme: "filled_black",
        size: "large",
        shape: "pill",
        text: "continue_with",
        width: 320,
      });
      setGoogleReady(true);
    };

    if (window.google) {
      init();
    } else {
      let script = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SRC}"]`);
      if (!script) {
        script = document.createElement("script");
        script.src = GSI_SRC;
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);
      }
      script.addEventListener("load", init, { once: true });
    }
    return () => {
      cancelled = true;
    };
  }, [account, step]);

  // Resend cooldown countdown.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  async function sendCode() {
    if (!emailValid || pending) return;
    setPending(true);
    setError(null);
    const res = await startOtp(email.trim());
    setPending(false);
    if (!res.ok) {
      setError(res.error ?? "Could not send a code. Try again.");
      return;
    }
    setStep("code");
    setCode("");
    setCooldown(RESEND_COOLDOWN);
  }

  async function resend() {
    if (cooldown > 0 || pending) return;
    setPending(true);
    setError(null);
    const res = await startOtp(email.trim());
    setPending(false);
    if (!res.ok) {
      setError(res.error ?? "Could not resend the code.");
      return;
    }
    setCooldown(RESEND_COOLDOWN);
  }

  async function submitCode() {
    if (!codeValid || pending) return;
    setPending(true);
    setError(null);
    const result = await verifyOtp(email.trim(), code, anonId);
    setPending(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    onSignedIn(result.account);
  }

  async function doSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    await onSignOut();
  }

  return (
    <div className="absolute inset-0 z-50 flex items-end bg-black/50 backdrop-blur-sm">
      <div className="animate-sheet w-full rounded-t-3xl border-t border-white/12 bg-[#0a0e12] p-5">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-white">
            {account ? "Your account" : "Claim your account"}
          </h2>
          <button
            onClick={onClose}
            className="rounded-full border border-white/10 px-2.5 py-1 text-[12px] text-white/50"
          >
            ✕
          </button>
        </div>

        {account ? (
          /* ---------------- SIGNED-IN ---------------- */
          <div>
            <div className="mb-5 flex items-center gap-3 rounded-2xl border border-white/10 bg-black/40 p-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-sonar text-[18px] font-bold text-[#04110c]">
                {account.displayName.trim()[0]?.toUpperCase() ?? "?"}
              </span>
              <div className="min-w-0">
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/40">
                  signed in as
                </p>
                <p className="truncate text-[15px] font-semibold text-white">
                  {account.displayName}
                </p>
              </div>
            </div>
            <p className="mb-5 text-[13px] leading-relaxed text-white/55">
              Your drops and likes are saved to this account — they follow you to
              any device you sign in on.
            </p>
            {onManageChannels && (
              <button
                onClick={onManageChannels}
                className="mb-2.5 flex w-full items-center justify-between rounded-2xl border border-white/12 bg-black/55 px-4 py-3.5 text-[15px] font-semibold text-white/85"
              >
                <span className="flex items-center gap-2">
                  <span className="text-sonar">🔒</span> My channels
                </span>
                <span className="text-white/35">›</span>
              </button>
            )}
            {onManage && (
              <button
                onClick={onManage}
                className="mb-2.5 flex w-full items-center justify-between rounded-2xl border border-white/12 bg-black/55 px-4 py-3.5 text-[15px] font-semibold text-white/85"
              >
                <span className="flex items-center gap-2">
                  <span className="text-sonar">∞</span> Permanent waypoints
                </span>
                <span className="text-white/35">›</span>
              </button>
            )}
            <button
              onClick={doSignOut}
              disabled={signingOut}
              className="w-full rounded-2xl border border-white/12 bg-black/55 py-3.5 text-[15px] font-semibold text-white/85 disabled:opacity-40"
            >
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        ) : (
          /* ---------------- CLAIM / SIGN-IN ---------------- */
          <div>
            {/* Radar-ring brand accent */}
            <div className="mb-4 flex items-center gap-3">
              <span className="relative flex h-9 w-9 shrink-0 items-center justify-center">
                <span className="absolute h-9 w-9 rounded-full border border-sonar/30" />
                <span className="absolute h-6 w-6 rounded-full border border-sonar/50" />
                <span className="absolute inline-flex h-2.5 w-2.5 animate-ping rounded-full bg-sonar/70" />
                <span className="relative h-2 w-2 rounded-full bg-sonar" />
              </span>
              <p className="text-[13px] leading-snug text-white/60">
                {step === "email"
                  ? "Save your drops across devices. We'll email a 6-digit code — no password."
                  : `Enter the 6-digit code sent to ${email.trim()}.`}
              </p>
            </div>

            {step === "email" ? (
              <>
                <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white/40">
                  email
                </p>
                <input
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendCode()}
                  placeholder="you@example.com"
                  className="mb-3 w-full rounded-2xl border border-white/12 bg-black/40 p-3.5 text-[14px] text-white placeholder:text-white/35 focus:border-sonar/50 focus:outline-none"
                />

                {error && (
                  <p className="mb-3 rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">
                    {error}
                  </p>
                )}

                <button
                  onClick={sendCode}
                  disabled={!emailValid || pending}
                  className="w-full rounded-2xl bg-sonar py-3.5 text-[15px] font-semibold text-[#04110c] disabled:opacity-40"
                >
                  {pending ? "Sending…" : "Email me a code"}
                </button>

                {GOOGLE_CLIENT_ID && (
                  <>
                    <div className="my-4 flex items-center gap-3">
                      <span className="h-px flex-1 bg-white/10" />
                      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/30">
                        or
                      </span>
                      <span className="h-px flex-1 bg-white/10" />
                    </div>
                    <div className="flex justify-center">
                      <div ref={googleRef} />
                    </div>
                    {!googleReady && (
                      <p className="mt-2 text-center font-mono text-[10px] text-white/30">
                        loading Google…
                      </p>
                    )}
                  </>
                )}
              </>
            ) : (
              <>
                <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white/40">
                  code
                </p>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  onKeyDown={(e) => e.key === "Enter" && submitCode()}
                  placeholder="000000"
                  autoFocus
                  className="mb-3 w-full rounded-2xl border border-white/12 bg-black/40 p-3.5 text-center font-mono text-[22px] tracking-[0.5em] text-white placeholder:text-white/20 focus:border-sonar/50 focus:outline-none"
                />

                {error && (
                  <p className="mb-3 rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">
                    {error}
                  </p>
                )}

                <button
                  onClick={submitCode}
                  disabled={!codeValid || pending}
                  className="w-full rounded-2xl bg-sonar py-3.5 text-[15px] font-semibold text-[#04110c] disabled:opacity-40"
                >
                  {pending ? "Verifying…" : "Verify & claim"}
                </button>

                <div className="mt-4 flex items-center justify-between">
                  <button
                    onClick={() => {
                      setStep("email");
                      setError(null);
                      setCode("");
                    }}
                    className="text-[12px] text-white/50 hover:text-white/75"
                  >
                    ← use a different email
                  </button>
                  <button
                    onClick={resend}
                    disabled={cooldown > 0 || pending}
                    className="text-[12px] text-sonar disabled:text-white/30"
                  >
                    {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
