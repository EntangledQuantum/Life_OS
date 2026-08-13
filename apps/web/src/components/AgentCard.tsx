import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { svgToDataUri, type DashboardCard } from "@life-os/shared";
import { Check } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export function AgentCard({
  card,
  onComplete,
  busy,
}: {
  card: DashboardCard;
  onComplete: () => void;
  busy?: boolean;
}) {
  const done = card.status === "done";
  const color = card.themeColor ?? "#5B8CFF";
  const img = card.imageData || card.imageUrl;
  // Agent-supplied SVG is sanitized server-side and rendered via <img>,
  // so it is inert even if something slipped through.
  const svg = card.svg ? svgToDataUri(card.svg) : null;

  return (
    <article
      className={cn(
        "relative overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03]",
        done && "opacity-70",
      )}
      style={{ borderColor: `${color}44` }}
    >
      {svg ? (
        <div
          className="flex h-32 w-full items-center justify-center overflow-hidden"
          style={{ background: `linear-gradient(160deg, ${color}1A, transparent)` }}
        >
          <img src={svg} alt="" className="max-h-24 w-auto max-w-[70%]" />
        </div>
      ) : (
        img && (
          <div className="relative h-36 w-full overflow-hidden bg-black/30">
            <img src={img} alt="" className="h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-[oklch(7%_0.01_260)] to-transparent" />
          </div>
        )
      )}
      <div className="space-y-3 p-4">
        <div className="flex items-start gap-3">
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xl"
            style={{ background: `${color}22` }}
          >
            {card.emoji ?? "📌"}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold leading-tight">{card.title}</h3>
              <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--faint)]">
                agent · slot {card.slot}
              </span>
            </div>
            {card.subtitle && (
              <p className="mt-0.5 text-sm text-[var(--muted)]">{card.subtitle}</p>
            )}
          </div>
        </div>

        {card.body && (
          <p className="text-sm leading-relaxed text-[var(--muted)] whitespace-pre-wrap">
            {card.body}
          </p>
        )}

        {typeof card.progress === "number" && card.progress > 0 && (
          <div>
            <div className="mb-1 flex justify-between font-mono text-[10px] text-[var(--faint)]">
              <span>progress</span>
              <span>{card.progress}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className="h-full rounded-full"
                style={{ width: `${card.progress}%`, background: color }}
              />
            </div>
          </div>
        )}

        {card.control && <CardControlWidget card={card} />}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          {card.ctaLink && (
            <a
              href={card.ctaLink}
              target="_blank"
              rel="noreferrer"
              className="btn py-2 text-sm"
            >
              {card.ctaLabel ?? "Open"}
            </a>
          )}
          {!done && (
            <button
              type="button"
              className="btn btn-primary py-2 text-sm"
              disabled={busy}
              onClick={onComplete}
            >
              <Check className="h-3.5 w-3.5" />
              {card.ctaLabel && !card.ctaLink
                ? card.ctaLabel
                : card.xpOnComplete > 0
                  ? `Complete · +${card.xpOnComplete} XP`
                  : "Complete"}
            </button>
          )}
          {done && (
            <span className="font-mono text-xs text-[var(--accent)]">Done</span>
          )}
        </div>
      </div>
    </article>
  );
}

/**
 * The agent's own widget on a card.
 *
 * Deliberately not a completion: an agent asking "how did that feel, 1–10"
 * wants the answer, not the card gone. The slider commits on release rather
 * than on every pixel — a drag from 1 to 9 would otherwise be nine POSTs and,
 * if the agent subscribed, nine webhooks.
 */
function CardControlWidget({ card }: { card: DashboardCard }) {
  const qc = useQueryClient();
  const control = card.control!;
  const [draft, setDraft] = useState(
    control.kind === "slider" ? control.value : 0,
  );

  const interact = useMutation({
    mutationFn: (body: { value?: number; pressed?: boolean }) =>
      api.interactWithCard(card.id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dashboard"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  if (control.kind === "button") {
    const pressed = Boolean(control.pressedAt);
    return (
      <button
        type="button"
        className={cn("btn w-full py-2 text-sm", pressed && "opacity-60")}
        disabled={interact.isPending || pressed}
        onClick={() => interact.mutate({ pressed: true })}
      >
        {pressed ? `${control.label} ✓` : control.label}
      </button>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label
          htmlFor={`control-${card.id}`}
          className="text-xs text-[var(--muted)]"
        >
          {control.label}
        </label>
        <span className="font-mono text-sm tabular-nums text-[var(--text)]">
          {draft}
          {control.unit ? ` ${control.unit}` : ""}
        </span>
      </div>
      <input
        id={`control-${card.id}`}
        type="range"
        className="w-full accent-[var(--accent)]"
        min={control.min}
        max={control.max}
        step={control.step ?? 1}
        value={draft}
        disabled={interact.isPending}
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={() => interact.mutate({ value: draft })}
        onKeyUp={(e) => {
          if (e.key.startsWith("Arrow")) interact.mutate({ value: draft });
        }}
      />
    </div>
  );
}
