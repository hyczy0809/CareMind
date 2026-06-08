// Robust XML-style extractor for on-device LLM output.
//
// We do NOT use a full XML parser — a) DOMParser doesn't ship in React Native,
// b) the model emits regex-friendly tag-pair output, not real XML (no
// namespaces, no attributes with single quotes, no CDATA). A tiny regex-driven
// reader is enough and tolerates many of the "small model" failure modes:
//
//   - mixed full-width punctuation in attributes (we strip them on read)
//   - missing closing tag at end-of-output (we treat to-EOF as the value)
//   - extra prose before/after the structured block (we ignore it)
//   - attribute values with no quotes (`severity=high`)
//   - self-closing tags (`<guardrail triggered="false"/>`)
//
// A single field failing to parse never poisons sibling fields — that's the
// whole reason we picked tag-style output over JSON.

/** Decode the handful of XML entities the model might emit. */
function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Quote-tolerant attribute reader. Accepts "v", 'v', or bare v. */
function readAttr(openTag: string, name: string): string | null {
  // Prefer double-quoted, then single-quoted, then bare (no spaces/`>`).
  const re = new RegExp(
    `\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>"']+))`,
    "i"
  );
  const m = openTag.match(re);
  if (!m) return null;
  return decodeEntities(m[1] ?? m[2] ?? m[3] ?? "");
}

/**
 * Find the first occurrence of `<tag ...>...</tag>` in `text`, returning
 * inner text, attributes (raw open tag), and the slice end index so callers
 * can iterate forward without re-matching.
 *
 * Tolerant of:
 *  - missing closing tag (returns innerText = "" and the end of input as endIdx)
 *  - self-closing tags (returns "" and end after the `/>`)
 *  - leading/trailing whitespace on the inner text
 */
export interface TagMatch {
  /** Raw open-tag text, e.g. `<attention type="night_safety" severity="high">`. */
  openTag: string;
  /** Inner text (trimmed). Empty for self-closing or missing-close-tag cases. */
  inner: string;
  /** Index in the source string where this match ends (exclusive). */
  endIdx: number;
}

/** Walk `text` from `fromIdx` looking for the next `<tag ...` opener. */
function findTagAt(text: string, tag: string, fromIdx: number): TagMatch | null {
  const openRe = new RegExp(`<${tag}\\b([^>]*?)(/?)>`, "g");
  openRe.lastIndex = fromIdx;
  const open = openRe.exec(text);
  if (!open) return null;

  const openTag = open[0];
  const selfClosing = open[2] === "/";
  const afterOpen = open.index + openTag.length;

  if (selfClosing) {
    return { openTag, inner: "", endIdx: afterOpen };
  }

  // Look for matching close. If missing, treat the rest of the input as inner.
  const closeRe = new RegExp(`</${tag}>`, "g");
  closeRe.lastIndex = afterOpen;
  const close = closeRe.exec(text);
  if (!close) {
    return {
      openTag,
      inner: decodeEntities(text.slice(afterOpen).trim()),
      endIdx: text.length
    };
  }
  return {
    openTag,
    inner: decodeEntities(text.slice(afterOpen, close.index).trim()),
    endIdx: close.index + close[0].length
  };
}

/** Pull the inner text of the first `<tag>...</tag>` in `text`. */
export function pickTag(text: string, tag: string): string | null {
  const m = findTagAt(text, tag, 0);
  return m ? m.inner : null;
}

/** Pull an attribute from the first `<tag ...>` in `text`. */
export function pickAttr(text: string, tag: string, attr: string): string | null {
  const m = findTagAt(text, tag, 0);
  return m ? readAttr(m.openTag, attr) : null;
}

/**
 * Pull every `<tag ...>...</tag>` block. Caller gets back `openTag`/`inner`
 * pairs and can decode attributes via {@link readAttr}.
 */
export function pickAllTags(text: string, tag: string): TagMatch[] {
  const out: TagMatch[] = [];
  let cursor = 0;
  while (true) {
    const next = findTagAt(text, tag, cursor);
    if (!next) break;
    out.push(next);
    if (next.endIdx <= cursor) break; // guard against pathological no-progress
    cursor = next.endIdx;
  }
  return out;
}

/** Attribute reader exposed for callers that already have a `TagMatch`. */
export function readTagAttr(match: TagMatch, name: string): string | null {
  return readAttr(match.openTag, name);
}

// ---- Light coercions, mirroring json-extract.ts for shared call sites ------

const TRUE_TOKENS = new Set(["true", "yes", "y", "1", "是", "真"]);
const FALSE_TOKENS = new Set(["false", "no", "n", "0", "否", "假"]);

/** "true"/"false"/"unknown" → boolean | "unknown". Anything else → "unknown". */
export function coerceUnknownBoolean(value: unknown): boolean | "unknown" {
  if (typeof value === "boolean") return value;
  if (value == null) return "unknown";
  const s = String(value).trim().toLowerCase();
  if (TRUE_TOKENS.has(s)) return true;
  if (FALSE_TOKENS.has(s)) return false;
  return "unknown";
}

/** Strict boolean — "true"/"yes" etc. → true, everything else → defaultValue. */
export function coerceBoolean(value: unknown, defaultValue: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value == null) return defaultValue;
  const s = String(value).trim().toLowerCase();
  if (TRUE_TOKENS.has(s)) return true;
  if (FALSE_TOKENS.has(s)) return false;
  return defaultValue;
}

export function coerceString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value.trim();
  if (value == null) return fallback;
  return String(value).trim();
}

/** Parse a number, accepting "3", "3次", "三" → 3 (best-effort). */
export function coerceNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  // Common case first: leading digits.
  const m = s.match(/^-?\d+(?:\.\d+)?/);
  if (m) {
    const n = Number(m[0]);
    return Number.isFinite(n) ? n : null;
  }
  // Chinese numerals (small range — only what realistic prompts emit).
  const cn: Record<string, number> = {
    零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
    六: 6, 七: 7, 八: 8, 九: 9, 十: 10
  };
  if (cn[s] != null) return cn[s];
  return null;
}

/**
 * Split a string-list field. Supports the two formats the prompt can ask for:
 *   1. One `<item>foo</item>` per array entry (preferred — survives commas
 *      inside individual items).
 *   2. A single `<list>foo; bar; baz</list>` with semicolons or newlines.
 * Pass the inner text of the enclosing tag.
 */
export function pickItemList(inner: string): string[] {
  if (!inner) return [];
  const itemMatches = pickAllTags(inner, "item");
  if (itemMatches.length > 0) {
    return itemMatches
      .map((m) => m.inner.trim())
      .filter((s) => s.length > 0);
  }
  return inner
    .split(/[;；\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
