// Single source of truth for the local LLM output format.
//
// Why a switch: smaller on-device models (Gemma 1B–4B class) are noticeably
// more reliable with XML-style tag output than with strict JSON. XML is the
// default and recommended path; JSON is kept as a fallback so an unexpected
// XML parsing regression doesn't kill on-device inference altogether and
// so we can A/B the two formats on the same device.
//
// Set EXPO_PUBLIC_LOCAL_OUTPUT_FORMAT=json (or xml) at build time. Defaults
// to "xml" when unset.

export type LocalOutputFormat = "json" | "xml";

const RAW = (process.env.EXPO_PUBLIC_LOCAL_OUTPUT_FORMAT ?? "xml")
  .trim()
  .toLowerCase();

export const LOCAL_OUTPUT_FORMAT: LocalOutputFormat =
  RAW === "json" ? "json" : "xml";

/** True when the on-device LLM should be prompted for XML-style output. */
export function isXmlOutput(): boolean {
  return LOCAL_OUTPUT_FORMAT === "xml";
}
