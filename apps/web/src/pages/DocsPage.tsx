import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import rehypeSlug from "rehype-slug";
import { Check, Copy, FileText, Github, Menu, Search, X } from "lucide-react";
import { asset, REPO_URL } from "@/lib/deploy";
import { cn } from "@/lib/utils";
import {
  DOC_GROUPS,
  DOCS,
  docBySlug,
  stripFrontmatter,
  type DocPage,
} from "@/docs/catalog";
import "highlight.js/styles/github-dark.css";

function githubBlob(file: string) {
  return `${REPO_URL}/blob/master/${file}`;
}

function resolveDocHref(href: string | undefined): string | null {
  if (!href) return null;
  if (/^https?:\/\//i.test(href) || href.startsWith("mailto:")) return null;
  const cleaned = href.split("#")[0].replace(/^\.\//, "");
  const map: Record<string, string> = {
    "NETWORK.md": "/docs/network",
    "API.md": "/docs/api",
    "DATABASE.md": "/docs/database",
    "AGENT_SETUP.md": "/docs/setup",
    "AGENT_HOOKS.md": "/docs/hooks",
    "LIFE_OS.md": "/docs/overview",
    "../../AGENT_SETUP.md": "/docs/setup",
    "../../API.md": "/docs/api",
  };
  const key = Object.keys(map).find((k) => cleaned.endsWith(k));
  return key ? map[key] : null;
}

export function DocsPage() {
  const { slug } = useParams();
  const page = docBySlug(slug);
  const body = useMemo(() => stripFrontmatter(page.markdown), [page]);
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [page.slug]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return DOCS;
    return DOCS.filter(
      (d) =>
        d.title.toLowerCase().includes(q) ||
        d.description.toLowerCase().includes(q) ||
        d.file.toLowerCase().includes(q),
    );
  }, [query]);

  async function copyMarkdown() {
    await navigator.clipboard.writeText(page.markdown);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="relative min-h-screen">
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="app-aurora app-aurora-a" />
        <div className="app-aurora app-aurora-c" />
        <div className="app-grid-lines" />
        <div className="app-vignette" />
      </div>

      <header className="sticky top-0 z-50 border-b border-white/[0.05] bg-[oklch(7%_0.01_260_/_0.8)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1400px] items-center gap-4 px-4 py-3 sm:px-6">
          <button
            type="button"
            className="btn px-2 py-2 lg:hidden"
            aria-label="Open topics"
            onClick={() => setNavOpen(true)}
          >
            <Menu className="h-4 w-4" />
          </button>
          <Link to="/" className="flex shrink-0 items-center gap-2.5">
            <img src={asset("icon.png?v=3")} alt="" className="h-8 w-8" />
            <span className="text-base font-bold tracking-tight">LIFE OS</span>
          </Link>
          <span className="hidden text-white/20 sm:inline">/</span>
          <span className="hidden font-mono text-xs uppercase tracking-[0.16em] text-[var(--faint)] sm:inline">
            Docs
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Link to="/" className="btn px-3 py-2 text-sm">
              Home
            </Link>
            <a
              href={githubBlob(page.file)}
              target="_blank"
              rel="noreferrer"
              className="btn px-3 py-2"
              aria-label="View source on GitHub"
            >
              <Github className="h-4 w-4" />
            </a>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1400px]">
        <aside className="sticky top-[57px] hidden h-[calc(100vh-57px)] w-72 shrink-0 overflow-y-auto border-r border-white/[0.05] px-4 py-6 lg:block">
          <Sidebar
            query={query}
            onQuery={setQuery}
            filtered={filtered}
            current={page.slug}
          />
        </aside>

        {navOpen ? (
          <div className="fixed inset-0 z-50 lg:hidden">
            <button
              type="button"
              className="absolute inset-0 bg-black/60"
              aria-label="Close topics"
              onClick={() => setNavOpen(false)}
            />
            <div className="absolute inset-y-0 left-0 w-[min(100%,20rem)] overflow-y-auto border-r border-white/[0.06] bg-[oklch(8%_0.012_260)] px-4 py-5">
              <div className="mb-4 flex items-center justify-between">
                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--faint)]">
                  Topics
                </p>
                <button
                  type="button"
                  className="btn px-2 py-2"
                  onClick={() => setNavOpen(false)}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <Sidebar
                query={query}
                onQuery={setQuery}
                filtered={filtered}
                current={page.slug}
                onPick={() => setNavOpen(false)}
              />
            </div>
          </div>
        ) : null}

        <main className="min-w-0 flex-1 px-5 py-10 sm:px-10">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--faint)]">
            {page.group} · {page.file}
          </p>
          <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
                {page.title}
              </h1>
              <p className="mt-2 max-w-2xl text-[var(--muted)]">
                {page.description}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn px-3 py-2 text-sm"
                onClick={() => void copyMarkdown()}
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                Copy markdown
              </button>
              <a
                href={githubBlob(page.file)}
                target="_blank"
                rel="noreferrer"
                className="btn px-3 py-2 text-sm"
              >
                <FileText className="h-3.5 w-3.5" />
                Source
              </a>
            </div>
          </div>

          <article className="docs-prose mt-10 max-w-3xl">
            <Markdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeSlug, rehypeHighlight]}
              components={{
                a: ({ href, children }) => {
                  const internal = resolveDocHref(href);
                  if (internal) {
                    return <Link to={internal}>{children}</Link>;
                  }
                  const external = href && /^https?:\/\//i.test(href);
                  return (
                    <a
                      href={href}
                      target={external ? "_blank" : undefined}
                      rel={external ? "noreferrer" : undefined}
                    >
                      {children}
                    </a>
                  );
                },
                pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
              }}
            >
              {body}
            </Markdown>
          </article>
        </main>
      </div>
    </div>
  );
}

function Sidebar({
  query,
  onQuery,
  filtered,
  current,
  onPick,
}: {
  query: string;
  onQuery: (v: string) => void;
  filtered: DocPage[];
  current: string;
  onPick?: () => void;
}) {
  return (
    <>
      <label className="relative mb-6 block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--faint)]" />
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search docs"
          className="input input-icon-left py-2 text-sm"
        />
      </label>
      {DOC_GROUPS.map((group) => {
        const items = filtered.filter((d) => d.group === group);
        if (items.length === 0) return null;
        return (
          <div key={group} className="mb-6">
            <p className="mb-2 px-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--faint)]">
              {group}
            </p>
            <ul className="space-y-0.5">
              {items.map((d) => (
                <li key={d.slug}>
                  <Link
                    to={`/docs/${d.slug}`}
                    onClick={onPick}
                    className={cn(
                      "block rounded-lg px-2 py-1.5 text-sm leading-snug transition-colors",
                      d.slug === current
                        ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                        : "text-[var(--muted)] hover:bg-white/[0.04] hover:text-[var(--text)]",
                    )}
                  >
                    {d.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </>
  );
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const [ok, setOk] = useState(false);

  function textOf(node: ReactNode): string {
    if (typeof node === "string" || typeof node === "number") return String(node);
    if (!node || typeof node !== "object") return "";
    if (Array.isArray(node)) return node.map(textOf).join("");
    if ("props" in node) {
      const props = (node as { props?: { children?: ReactNode } }).props;
      return textOf(props?.children);
    }
    return "";
  }

  async function copy() {
    await navigator.clipboard.writeText(textOf(children).replace(/\n$/, ""));
    setOk(true);
    window.setTimeout(() => setOk(false), 1400);
  }

  return (
    <div className="group relative">
      <pre>{children}</pre>
      <button
        type="button"
        onClick={() => void copy()}
        className="absolute right-2 top-2 rounded-md border border-white/10 bg-black/40 px-2 py-1 text-[10px] uppercase tracking-wider text-white/70 opacity-0 backdrop-blur transition-opacity group-hover:opacity-100"
      >
        {ok ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
