import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import QRCode from "qrcode";
import { RefreshCw, Smartphone, Wifi, WifiOff } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Pair a phone by scanning, instead of typing 43 characters of base64url.
 *
 * The token is never in the QR. The dashboard mints a short-lived, single-use
 * code; the phone's own camera app opens the URL, and the page there hands the
 * code to the app, which trades it for the real token over one request.
 *
 * Using the phone's built-in camera rather than a scanner inside the app is
 * deliberate: it means the app needs no camera permission and no native
 * barcode module, and it works before the app is even installed.
 */
export function PairPhone() {
  const [dataUri, setDataUri] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const timer = useRef<number | null>(null);

  const reach = useQuery({
    queryKey: ["reachability"],
    queryFn: api.reachability,
    staleTime: 60_000,
  });

  const mint = useMutation({
    mutationFn: () => api.mintPairing(),
    onSuccess: async (result) => {
      /*
       * Rendered locally rather than through a QR image service — the URL is
       * one request away from being a credential and has no business leaving
       * this machine.
       */
      setDataUri(
        await QRCode.toDataURL(result.url, {
          width: 512,
          margin: 1,
          color: { dark: "#0b0d12", light: "#ffffff" },
        }),
      );
      setSecondsLeft(result.expiresInSeconds);
    },
  });

  /* Count down, and clear the QR the moment the code stops working. */
  useEffect(() => {
    if (secondsLeft <= 0) return;
    timer.current = window.setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          setDataUri(null);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [secondsLeft > 0]);

  const publicUrl = reach.data?.publicUrl ?? null;
  const mm = String(Math.floor(secondsLeft / 60));
  const ss = String(secondsLeft % 60).padStart(2, "0");

  return (
    <section className="card space-y-4 p-5">
      <div>
        <h2 className="flex items-center gap-2 font-semibold">
          <Smartphone className="h-4 w-4" /> Pair a phone
        </h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Scan with your phone's camera. No typing, and the token never appears
          in the code — the phone trades a five-minute one-time code for it.
        </p>
      </div>

      {/* Where the phone will be told to connect, and whether that survives leaving the house. */}
      <div
        className={cn(
          "flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-xs",
          publicUrl
            ? "border-[#34D399]/25 bg-[#34D399]/[0.06]"
            : "border-[var(--border)]",
        )}
      >
        {publicUrl ? (
          <Wifi className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#34D399]" />
        ) : (
          <WifiOff className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--faint)]" />
        )}
        <div className="min-w-0">
          {publicUrl ? (
            <>
              <div className="font-medium">Reachable from anywhere</div>
              <div className="mt-0.5 break-all font-mono text-[11px] text-[var(--muted)]">
                {publicUrl}
              </div>
            </>
          ) : (
            <>
              <div className="font-medium">This Wi-Fi only</div>
              <p className="mt-0.5 leading-relaxed text-[var(--faint)]">
                Your phone will work at home and stop working when you leave.
                {reach.data?.hint ? ` ${reach.data.hint}` : ""}
              </p>
            </>
          )}
        </div>
      </div>

      {dataUri ? (
        <div className="flex flex-col items-center gap-3">
          <img
            src={dataUri}
            alt="Pairing QR code"
            className="h-52 w-52 rounded-xl bg-white p-2"
          />
          <div className="text-center">
            <div className="font-mono text-sm tabular-nums">
              expires in {mm}:{ss}
            </div>
            <p className="mt-1 text-[11px] text-[var(--faint)]">
              One use. Scan it again for a new one.
            </p>
          </div>
          <button
            type="button"
            className="btn py-1.5 text-xs"
            onClick={() => mint.mutate()}
            disabled={mint.isPending}
          >
            <RefreshCw className="h-3 w-3" /> New code
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => mint.mutate()}
          disabled={mint.isPending}
        >
          {mint.isPending ? "Generating…" : "Show pairing QR"}
        </button>
      )}

      {mint.isError && (
        <p className="text-xs text-[var(--warning,#FBBF24)]">
          {(mint.error as Error).message}
        </p>
      )}
    </section>
  );
}
