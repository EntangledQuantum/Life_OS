import { useState } from "react";
import { ChevronDown, ExternalLink } from "lucide-react";
import { svgToDataUri, type Task } from "@life-os/shared";
import { cn } from "@/lib/utils";

/**
 * Agent status strip — the task the agent wrote about itself at setup, marked
 * by `meta.connected`. It holds no slot: the two content slots are for cards
 * you act on, and this is not one of them.
 *
 * Deliberately not a full card: once you are connected this is ambient status,
 * not something you act on, so it collapses to a single line. The detail only
 * matters while you are still wiring an agent up, so it expands on click.
 *
 * Agent-supplied SVG is sanitized server-side and rendered through an `<img>`
 * data URI, which cannot execute script regardless of content.
 */
export function AgentSetupCard({ card }: { card: Task }) {
  const connected = Boolean(
    card.meta && (card.meta as { connected?: boolean }).connected,
  );
  const [open, setOpen] = useState(!connected);

  const color = connected ? "#34D399" : (card.themeColor ?? "#64748B");
  const graphic = card.svg
    ? svgToDataUri(card.svg)
    : card.imageData || card.imageUrl || null;
  const hasDetail = Boolean(card.body || card.ctaLink);

  return (
    <div
      className="overflow-hidden rounded-xl border"
      style={{
        borderColor: `${connected ? "#34D399" : "#64748B"}2E`,
        background: "rgba(255,255,255,0.02)",
      }}
    >
      <button
        type="button"
        onClick={() => hasDetail && setOpen((v) => !v)}
        aria-expanded={hasDetail ? open : undefined}
        className={cn(
          "flex w-full items-center gap-3 px-3.5 py-2.5 text-left",
          hasDetail && "transition-colors hover:bg-white/[0.03]",
        )}
      >
        <span className="relative flex h-2 w-2 shrink-0">
          {connected && (
            <span
              className="absolute inline-flex h-full w-full rounded-full opacity-40"
              style={{ background: color }}
            />
          )}
          <span
            className="relative inline-flex h-2 w-2 rounded-full"
            style={{ background: color }}
          />
        </span>

        {graphic ? (
          <img src={graphic} alt="" className="h-5 w-auto max-w-[36px] shrink-0" />
        ) : (
          <span className="shrink-0 text-sm" aria-hidden>
            {card.emoji ?? "🤖"}
          </span>
        )}

        <span className="min-w-0 flex-1 truncate text-sm">
          <span className="font-medium">{card.title}</span>
          {card.subtitle && (
            <span className="ml-2 text-[var(--faint)]">{card.subtitle}</span>
          )}
        </span>

        <span
          className="hidden shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] sm:inline"
          style={{ color: connected ? color : "var(--faint)" }}
        >
          {connected ? "agent connected" : "no agent"}
        </span>

        {hasDetail && (
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-[var(--faint)] transition-transform",
              open ? "rotate-0" : "-rotate-90",
            )}
          />
        )}
      </button>

      {hasDetail && (
        <div className="collapsible" data-collapsed={open ? "false" : "true"}>
          <div className="collapsible-inner">
            <div className="space-y-3 border-t border-white/[0.05] px-3.5 py-3">
              {card.body && (
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--muted)]">
                  {card.body}
                </p>
              )}
              {card.ctaLink && (
                <a
                  href={card.ctaLink}
                  target="_blank"
                  rel="noreferrer"
                  className="btn py-1.5 text-xs"
                >
                  {card.ctaLabel ?? "Open"}
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
