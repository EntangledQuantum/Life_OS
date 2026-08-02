import { useState, type ReactNode } from "react";
import { Check, ChevronDown, Copy } from "lucide-react";
import { useReveal } from "@/lib/useReveal";
import { cn } from "@/lib/utils";

/** Wraps children in a scroll-triggered fade-up. */
export function Reveal({
  children,
  className,
  delay = 0,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  as?: "div" | "section" | "li" | "article";
}) {
  const { ref, visible } = useReveal<HTMLDivElement>();
  return (
    <Tag
      ref={ref as never}
      className={cn("reveal", visible && "is-visible", className)}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </Tag>
  );
}

/** Section heading block: eyebrow + title + optional lede. */
export function SectionHeading({
  eyebrow,
  title,
  lede,
  align = "left",
}: {
  eyebrow: string;
  title: ReactNode;
  lede?: ReactNode;
  align?: "left" | "center";
}) {
  return (
    <Reveal className={align === "center" ? "text-center" : undefined}>
      <p className="section-eyebrow">{eyebrow}</p>
      <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
        {title}
      </h2>
      {lede && (
        <p
          className={cn(
            "mt-4 text-base leading-relaxed text-[var(--muted)] sm:text-lg",
            align === "center" ? "mx-auto max-w-2xl" : "max-w-2xl",
          )}
        >
          {lede}
        </p>
      )}
    </Reveal>
  );
}

/**
 * Terminal-style block with a copy button.
 *
 * `previewLines` keeps a long block from eating the page: it shows the first N
 * lines behind a fade with a toggle underneath. **Copy always takes the whole
 * thing**, collapsed or not — the preview is a display concern, never a
 * truncation of what lands on the clipboard.
 */
export function CodeBlock({
  code,
  label,
  previewLines,
}: {
  code: string;
  label?: string;
  previewLines?: number;
}) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const lines = code.split("\n");
  const collapsible = Boolean(previewLines && lines.length > previewLines);
  const collapsed = collapsible && !expanded;
  const shown = collapsed ? lines.slice(0, previewLines).join("\n") : code;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — the text is selectable anyway */
    }
  };

  return (
    <div>
      <div className="relative">
        {label && (
          <div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--faint)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
            {label}
          </div>
        )}

        <div className="relative">
          <pre className="code-block">
            <code>{shown}</code>
          </pre>
          {collapsed && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 bottom-0 h-24 rounded-b-[14px]"
              style={{
                background:
                  "linear-gradient(to bottom, transparent, oklch(9% 0.012 260) 92%)",
              }}
            />
          )}
        </div>

        <button
          type="button"
          onClick={copy}
          aria-label={`Copy all ${lines.length} lines to clipboard`}
          className="absolute right-2.5 flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.06] px-2.5 py-2 text-xs text-[var(--muted)] backdrop-blur transition-colors hover:bg-white/[0.12] hover:text-[var(--text)]"
          style={{ top: label ? "2.1rem" : "0.6rem" }}
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-[var(--accent)]" />
              <span className="text-[var(--accent)]">Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>

      {collapsible && (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1 font-mono text-[11px] text-[var(--muted)] transition-colors hover:bg-white/[0.05] hover:text-[var(--text)]"
          >
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 transition-transform",
                expanded ? "rotate-180" : "rotate-0",
              )}
            />
            {expanded ? "Show less" : `Show all ${lines.length} lines`}
          </button>
          <span className="font-mono text-[11px] text-[var(--faint)]">
            Copy takes the whole thing either way.
          </span>
        </div>
      )}
    </div>
  );
}
