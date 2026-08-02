import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { DashboardCard } from "@life-os/shared";
import { AgentCard } from "@/components/AgentCard";
import { AgentSetupCard } from "@/components/AgentSetupCard";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "lifeos.agentCards.collapsed";

/**
 * Agent cards used to dominate the dashboard as one huge block. They are now
 * collapsible: collapsed shows a one-line summary strip, expanded shows the
 * full cards. The choice persists across reloads.
 */
export function AgentCardsSection({
  cards,
  onComplete,
  busy,
}: {
  cards: DashboardCard[];
  onComplete: (id: string) => void;
  busy?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  });

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  const setupCard = cards.find((c) => c.kind === "agent-setup");
  const contentCards = cards
    .filter((c) => c.kind !== "agent-setup")
    .sort((a, b) => a.slot - b.slot)
    .slice(0, 2);

  if (contentCards.length === 0 && !setupCard) return null;

  const openCount = contentCards.filter((c) => c.status !== "done").length;

  return (
    <section>
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
        className="group flex w-full items-center gap-3 border-b border-white/[0.06] pb-2 text-left"
      >
        <h2 className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--faint)]">
          Agent cards
        </h2>

        <span className="font-mono text-[10px] text-[var(--faint)]">
          {contentCards.length} card{contentCards.length === 1 ? "" : "s"}
          {openCount > 0 && ` · ${openCount} open`}
        </span>

        {/* Collapsed strip keeps the cards glanceable without the bulk. */}
        {collapsed && (
          <span className="ml-auto flex min-w-0 items-center gap-3 pr-1">
            {contentCards.map((c) => (
              <span
                key={c.id}
                className="flex min-w-0 items-center gap-1.5 text-xs text-[var(--muted)]"
              >
                <span aria-hidden>{c.emoji ?? "📌"}</span>
                <span className="max-w-[13ch] truncate sm:max-w-[22ch]">
                  {c.title}
                </span>
                {c.status === "done" ? (
                  <span className="font-mono text-[10px] text-[var(--accent)]">
                    done
                  </span>
                ) : (
                  c.progress > 0 && (
                    <span className="font-mono text-[10px] text-[var(--faint)]">
                      {c.progress}%
                    </span>
                  )
                )}
              </span>
            ))}
          </span>
        )}

        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-[var(--faint)] transition-transform group-hover:text-[var(--muted)]",
            collapsed ? "-rotate-90" : "rotate-0",
            !collapsed && "ml-auto",
          )}
        />
      </button>

      {/* Agent status is one line and always useful — it stays out of the collapse. */}
      {setupCard && (
        <div className="mt-3">
          <AgentSetupCard card={setupCard} />
        </div>
      )}

      {/*
        Grid-rows collapse (0fr → 1fr) rather than an animated height: it cannot
        get stuck mid-exit, needs no measurement, and degrades to an instant
        toggle when the transition is disabled.
      */}
      <div
        className="collapsible"
        data-collapsed={collapsed ? "true" : "false"}
        aria-hidden={collapsed}
      >
        <div className="collapsible-inner">
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {contentCards.map((card) => (
              <AgentCard
                key={card.id}
                card={card}
                busy={busy}
                onComplete={() => onComplete(card.id)}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
