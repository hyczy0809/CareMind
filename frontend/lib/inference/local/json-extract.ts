// Robust JSON extraction from LLM output. Gemma's first reply isn't always
// clean JSON — it may wrap the object in ```json fences, add a preamble, or
// emit "unknown" where a boolean is expected. We strip / repair what we can,
// and let the caller fall back to a deterministic builder on failure.

/**
 * Pull the first balanced top-level JSON object out of `text`. Tolerates
 * markdown fences, leading/trailing prose, and trailing commas.
 * Returns `null` if no plausible JSON object is found.
 */
export function extractJsonObject(text: string): string | null {
  if (!text) return null;

  let body = text.trim();

  // Strip ``` or ```json fences if the whole reply is wrapped.
  const fenceMatch = body.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch) {
    body = fenceMatch[1].trim();
  }

  // Find the first '{' and walk forward tracking depth, ignoring chars in strings.
  const start = body.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < body.length; i++) {
    const ch = body[i];

    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\" && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return body.slice(start, i + 1);
      }
    }
  }

  return null;
}

function stripTrailingCommas(jsonText: string): string {
  return jsonText.replace(/,(\s*[}\]])/g, "$1");
}

/**
 * Parse a JSON object out of an LLM response. Returns `null` on any failure
 * rather than throwing — call sites are expected to fall back gracefully.
 */
export function parseJsonObject<T = unknown>(text: string): T | null {
  const slice = extractJsonObject(text);
  if (!slice) return null;

  try {
    return JSON.parse(slice) as T;
  } catch {
    try {
      return JSON.parse(stripTrailingCommas(slice)) as T;
    } catch (error) {
      console.warn("parseJsonObject failed", error, slice.slice(0, 200));
      return null;
    }
  }
}

/**
 * Coerce a value to UnknownBoolean (`boolean | "unknown"`) used by V2 schemas.
 * Gemma sometimes returns strings like "yes"/"no"/"unknown" where we want bools.
 */
export function coerceUnknownBoolean(value: unknown): boolean | "unknown" {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "yes" || value === "1") return true;
  if (value === "false" || value === "no" || value === "0") return false;
  return "unknown";
}

export function coerceString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function coerceStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

export function coerceNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}
