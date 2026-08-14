import { useEffect, useState } from "react";
import { Check, Copy, Smartphone } from "lucide-react";
import { asset } from "@/lib/deploy";
import { ANDROID_APK_URL } from "@/lib/deploy";

/**
 * Where the phone lands after scanning the QR.
 *
 * This page is opened by the phone's own camera app, which means it has to work
 * with no app installed, no token, and no assumptions about what the phone can
 * do. So it does exactly three things: hand the code to the app over a deep
 * link, show the code for manual entry when that fails, and offer the APK when
 * the app is not there at all.
 *
 * **The code is in the fragment**, so it never reaches this server, never lands
 * in an access log, and is never sent as a Referer. It is read here in the
 * browser and nowhere else.
 */
export function PairPage() {
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const raw = window.location.hash.replace(/^#/, "");
    const value = new URLSearchParams(raw).get("c");
    setCode(value && /^[A-Z2-9]{6,32}$/i.test(value) ? value.toUpperCase() : null);
  }, []);

  const base = `${window.location.protocol}//${window.location.host}`;

  /*
   * Two forms of the same link, because Android Chrome will not follow a bare
   * custom scheme from a page it did not navigate to. An `intent://` URL names
   * the package explicitly and is the documented way to hand off on Android;
   * everywhere else the custom scheme is right.
   *
   * The path is `/pair`, not `/connect`. The connect screen is redirected away
   * from the moment the phone is authenticated — which it usually is by the
   * time anyone re-pairs — so a link into it opened the app and bounced
   * straight to Today, looking for all the world like the link was dead.
   */
  const query = code
    ? `code=${encodeURIComponent(code)}&url=${encodeURIComponent(base)}`
    : null;
  const schemeLink = query ? `lifeos://pair?${query}` : null;
  const intentLink = query
    ? `intent://pair?${query}#Intent;scheme=lifeos;package=com.lifeos.app;` +
      `S.browser_fallback_url=${encodeURIComponent(`${base}/pair#c=${code}`)};end`
    : null;
  const isAndroid =
    typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);
  const deepLink = (isAndroid ? intentLink : schemeLink) ?? null;

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-5 py-12">
      <div className="flex items-center gap-3">
        <img src={asset("icon.png?v=3")} alt="" className="h-10 w-10" />
        <span className="text-xl font-bold tracking-tight">LIFE OS</span>
      </div>

      {!code ? (
        <div className="card p-5">
          <h1 className="font-semibold">No pairing code</h1>
          <p className="mt-1.5 text-sm leading-relaxed text-[var(--muted)]">
            This page needs a code from a QR. Open Life OS on your computer, go
            to Settings → Pair a phone, and scan the code it shows.
          </p>
        </div>
      ) : (
        <>
          <div>
            <h1 className="text-2xl font-bold">Connect this phone</h1>
            <p className="mt-1.5 text-sm leading-relaxed text-[var(--muted)]">
              This code works once and expires in five minutes.
            </p>
          </div>

          <a href={deepLink!} className="btn btn-primary justify-center py-3 text-base">
            <Smartphone className="h-4 w-4" /> Open in Life OS
          </a>

          {/*
            Some in-app browsers block both forms. Offering the other one is
            cheaper than making someone type a twelve-character code.
          */}
          {isAndroid && schemeLink && (
            <a
              href={schemeLink}
              className="btn justify-center py-2 text-sm"
            >
              Didn&apos;t work? Try the other way
            </a>
          )}

          <div className="card p-5">
            <h2 className="text-sm font-semibold">
              Nothing happened when you tapped that?
            </h2>
            <p className="mt-1.5 text-xs leading-relaxed text-[var(--muted)]">
              The app is probably not installed, or the phone did not offer to
              open it. Install it, then paste this code into the connect screen:
            </p>

            <div className="mt-3 flex items-stretch gap-2">
              <code className="min-w-0 flex-1 select-all rounded-lg bg-black/30 px-3 py-2.5 text-center font-mono text-lg tracking-[0.2em]">
                {code}
              </code>
              <button
                type="button"
                className="btn shrink-0 px-3"
                aria-label="Copy the code"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(code);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  } catch {
                    /* selectable text is the fallback */
                  }
                }}
              >
                {copied ? (
                  <Check className="h-4 w-4 text-[#34D399]" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </button>
            </div>

            <p className="mt-3 font-mono text-[11px] break-all text-[var(--faint)]">
              server: {base}
            </p>

            <a
              href={ANDROID_APK_URL}
              className="btn mt-4 w-full justify-center py-2 text-sm"
            >
              Download the Android app
            </a>
          </div>
        </>
      )}
    </div>
  );
}
