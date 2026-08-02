/**
 * Sanitizer for agent-supplied inline SVG (dashboard card graphics).
 *
 * Agents are trusted to write to this app, but their SVG often originates from
 * model output or third-party sources, so it is treated as untrusted markup.
 * Sanitized SVG is additionally rendered inside an `<img src="data:image/svg+xml,…">`
 * on the client, which blocks scripting entirely — this pass is defence in depth
 * and keeps the stored payload small and inspectable.
 */

export const MAX_SVG_LENGTH = 64_000;

/** Elements that can execute, navigate, or pull in remote content. */
const FORBIDDEN_ELEMENTS = [
  "script",
  "foreignObject",
  "iframe",
  "embed",
  "object",
  "audio",
  "video",
  "animate",
  "animateTransform",
  "animateMotion",
  "set",
  "handler",
  "listener",
  "use",
  "image",
  "a",
  "style",
];

/** Attributes carrying script, external references, or navigation. */
const FORBIDDEN_ATTR_PATTERNS = [
  /\son[a-z-]+\s*=\s*"[^"]*"/gi,
  /\son[a-z-]+\s*=\s*'[^']*'/gi,
  /\son[a-z-]+\s*=\s*[^\s>]+/gi,
  /\s(?:xlink:href|href|src|formaction|ping|externalResourcesRequired)\s*=\s*"[^"]*"/gi,
  /\s(?:xlink:href|href|src|formaction|ping|externalResourcesRequired)\s*=\s*'[^']*'/gi,
];

function stripElement(markup: string, tag: string): string {
  const paired = new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}\\s*>`, "gi");
  const selfClosing = new RegExp(`<${tag}\\b[^>]*\\/?>`, "gi");
  return markup.replace(paired, "").replace(selfClosing, "");
}

export interface SvgSanitizeResult {
  /** Sanitized markup, or null when the input cannot be salvaged. */
  svg: string | null;
  /** Human-readable reasons the input was rejected or altered. */
  notes: string[];
}

/**
 * Strip scripting, remote references, and non-SVG wrappers from `input`.
 * Returns `svg: null` when the input is not usable SVG.
 */
export function sanitizeSvg(input: unknown): SvgSanitizeResult {
  const notes: string[] = [];
  if (input === null || input === undefined || input === "") {
    return { svg: null, notes };
  }
  if (typeof input !== "string") {
    return { svg: null, notes: ["svg must be a string"] };
  }

  let markup = input.trim();

  if (markup.length > MAX_SVG_LENGTH) {
    return {
      svg: null,
      notes: [`svg exceeds ${MAX_SVG_LENGTH} characters`],
    };
  }

  // Drop XML prologue / doctype / comments before structural checks.
  markup = markup
    .replace(/<\?xml[\s\S]*?\?>/gi, "")
    .replace(/<!DOCTYPE[\s\S]*?>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();

  if (!/^<svg\b/i.test(markup) || !/<\/svg\s*>$/i.test(markup)) {
    return { svg: null, notes: ["svg must be a single root <svg>…</svg> element"] };
  }

  for (const tag of FORBIDDEN_ELEMENTS) {
    const before = markup;
    markup = stripElement(markup, tag);
    if (markup !== before) notes.push(`removed <${tag}> element(s)`);
  }

  for (const pattern of FORBIDDEN_ATTR_PATTERNS) {
    const before = markup;
    markup = markup.replace(pattern, "");
    if (markup !== before) notes.push("removed event handler or external reference");
  }

  // Any remaining URL-ish payload that could execute or phone home.
  const before = markup;
  markup = markup.replace(/(?:javascript|data|vbscript)\s*:/gi, "");
  if (markup !== before) notes.push("removed inline URL scheme");

  markup = markup.trim();
  if (!/^<svg\b[\s\S]*<\/svg\s*>$/i.test(markup)) {
    return { svg: null, notes: [...notes, "svg became malformed after sanitizing"] };
  }

  // Sanitizing can leave a valid but empty <svg></svg> — storing that would
  // render an empty graphic box on the card. Treat it as no artwork at all.
  const body = markup.replace(/^<svg\b[^>]*>/i, "").replace(/<\/svg\s*>$/i, "");
  if (!/<[a-z]/i.test(body)) {
    return {
      svg: null,
      notes: [...notes, "svg had no drawable content after sanitizing"],
    };
  }

  return { svg: markup, notes };
}

/**
 * Encode sanitized SVG for use as an `<img>` source.
 * Rendering through `<img>` means even a missed vector cannot execute.
 */
export function svgToDataUri(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
