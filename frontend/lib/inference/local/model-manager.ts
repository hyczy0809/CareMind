// Higher-level model lifecycle around the native module. Maintains
// **per-filename** state so the PrivacyModeCard can show each model's
// own download / ready / error progress independently.
//
// Owns the small state machine that the settings UI watches:
//   absent → downloading → ready → error
// Plus convenience hooks. Keeps all native-side error / progress plumbing
// out of the React components.

import { useEffect, useState } from "react";
import { buildModelDownloadUrl, DEFAULT_MODEL_FILENAME } from "./constants";
import { Gemma, GEMMA_NATIVE_AVAILABLE, subscribeDownloadProgress } from "./gemma-native";
import type { GemmaEngineOptions } from "./gemma-native";
import {
  fetchModelCatalog,
  findModelById,
  resolveModelDownloadUrl,
  type ModelCatalogEntry
} from "./model-catalog";
import {
  getSelectedModelIdSync,
  subscribeSelectedModelId,
  setSelectedModelId
} from "../privacy-mode";

export type ModelStatus =
  | "unsupported"
  | "absent"
  | "checking"
  | "downloading"
  | "ready"
  | "error";

export interface PerModelState {
  filename: string;
  status: ModelStatus;
  progress: number; // 0..1
  bytesDownloaded: number;
  totalBytes: number;
  errorMessage: string | null;
}

export interface ManagerState {
  /** True when the global stub mode flag is on (dev only). */
  stub: boolean;
  /** Per-filename rows. */
  byModel: Record<string, PerModelState>;
  /** Currently selected model id, if any. */
  selectedModelId: string | null;
}

function emptyEntry(filename: string): PerModelState {
  return {
    filename,
    status: GEMMA_NATIVE_AVAILABLE ? "checking" : "unsupported",
    progress: 0,
    bytesDownloaded: 0,
    totalBytes: 0,
    errorMessage: null
  };
}

let state: ManagerState = {
  stub: false,
  byModel: {},
  selectedModelId: getSelectedModelIdSync()
};
const subs = new Set<(s: ManagerState) => void>();
const HIGH_RISK_MODEL_IDS = new Set(["gemma-4-E2B-it.litertlm", "gemma-4-E4B-it.litertlm"]);

function preferredModelId(catalog: ModelCatalogEntry[]): string | null {
  return (
    catalog.find((entry) => entry.id === DEFAULT_MODEL_FILENAME)?.id ??
    catalog.find((entry) => entry.tier === "light")?.id ??
    catalog[0]?.id ??
    null
  );
}

function emit() {
  for (const sub of subs) {
    try {
      sub(state);
    } catch (error) {
      console.warn("model-manager subscriber threw", error);
    }
  }
}

function patchEntry(filename: string, next: Partial<PerModelState>) {
  const existing = state.byModel[filename] ?? emptyEntry(filename);
  state = {
    ...state,
    byModel: {
      ...state.byModel,
      [filename]: { ...existing, ...next, filename }
    }
  };
  emit();
}

function patchManager(next: Partial<ManagerState>) {
  state = { ...state, ...next };
  emit();
}

export function getManagerState(): ManagerState {
  return state;
}

export function getModelEntry(filename: string): PerModelState {
  return state.byModel[filename] ?? emptyEntry(filename);
}

export function subscribeManager(cb: (s: ManagerState) => void): () => void {
  subs.add(cb);
  cb(state);
  return () => {
    subs.delete(cb);
  };
}

/** Re-check whether a given model file is present on disk. */
export async function refreshModelStatus(filename: string): Promise<void> {
  if (!GEMMA_NATIVE_AVAILABLE) {
    patchEntry(filename, { status: "unsupported" });
    return;
  }
  patchEntry(filename, { status: "checking", errorMessage: null });
  try {
    const ready = await Gemma.isModelReady(filename);
    patchEntry(filename, {
      status: ready ? "ready" : "absent",
      progress: ready ? 1 : 0
    });
  } catch (error) {
    patchEntry(filename, {
      status: "error",
      errorMessage: error instanceof Error ? error.message : String(error)
    });
  }
}

/** Refresh all models in the catalog at once — used on app start. */
export async function refreshAllFromCatalog(): Promise<ModelCatalogEntry[]> {
  let catalog;
  try {
    catalog = await fetchModelCatalog(true);
  } catch (error) {
    console.warn("[model-manager] catalog fetch failed", error);
    return [];
  }
  for (const entry of catalog.models) {
    if (!state.byModel[entry.id]) {
      patchEntry(entry.id, { totalBytes: entry.size_bytes });
    } else {
      patchEntry(entry.id, { totalBytes: entry.size_bytes });
    }
    void refreshModelStatus(entry.id);
  }
  return catalog.models;
}

/** Kick off a download for the given model. */
export async function downloadModel(filename: string): Promise<void> {
  if (!GEMMA_NATIVE_AVAILABLE) {
    patchEntry(filename, { status: "unsupported" });
    return;
  }
  patchEntry(filename, {
    status: "downloading",
    progress: 0,
    bytesDownloaded: 0,
    errorMessage: null
  });

  try {
    const entry = await findModelById(filename);
    const url = entry ? resolveModelDownloadUrl(entry) : buildModelDownloadUrl(filename);
    await Gemma.downloadModel(filename, url, entry?.checksum_sha256);
    patchEntry(filename, { status: "ready", progress: 1 });
  } catch (error) {
    patchEntry(filename, {
      status: "error",
      errorMessage: error instanceof Error ? error.message : String(error)
    });
  }
}

export async function cancelDownload(filename: string): Promise<void> {
  if (!GEMMA_NATIVE_AVAILABLE) return;
  try {
    await Gemma.cancelDownload(filename);
  } catch (error) {
    console.warn("cancelDownload failed", error);
  }
  await refreshModelStatus(filename);
}

export async function deleteModel(filename: string): Promise<void> {
  if (!GEMMA_NATIVE_AVAILABLE) return;
  try {
    await Gemma.deleteModel(filename);
  } catch (error) {
    console.warn("deleteModel failed", error);
  }
  patchEntry(filename, {
    status: "absent",
    progress: 0,
    bytesDownloaded: 0,
    errorMessage: null
  });
}

/**
 * Toggle the dev-only stub mode. When enabled, the native module returns
 * canned responses without ever touching MediaPipe — lets us verify the
 * end-to-end wiring before the real model is downloaded.
 */
export async function setStubMode(enabled: boolean): Promise<void> {
  if (!GEMMA_NATIVE_AVAILABLE) return;
  try {
    await Gemma.setStubMode(enabled);
    patchManager({ stub: enabled });
    // Re-check status of all known models so the UI updates.
    for (const filename of Object.keys(state.byModel)) {
      void refreshModelStatus(filename);
    }
  } catch (error) {
    console.warn("setStubMode failed", error);
  }
}

/**
 * Resolve the filename of the currently selected model, falling back to
 * the first ready model in the catalog if no explicit selection exists.
 */
export async function resolveSelectedModelFilename(): Promise<string | null> {
  const catalog = await fetchModelCatalog();
  const preferred = preferredModelId(catalog.models);
  const selected = state.selectedModelId;
  if (!selected) return preferred;

  const exists = catalog.models.some((entry) => entry.id === selected);
  if (HIGH_RISK_MODEL_IDS.has(selected) && preferred && preferred !== selected) {
    await setSelectedModelId(preferred);
    return preferred;
  }
  if (!exists && preferred) {
    await setSelectedModelId(preferred);
    return preferred;
  }
  if (!exists) {
    await setSelectedModelId(null);
    return null;
  }
  return selected;
}

/**
 * Lazily make sure the engine is ready to generate using the currently
 * selected model. Throws if no model file exists.
 */
/**
 * Lazily make sure the engine is ready to generate using the currently
 * selected model. Throws if no model file exists.
 *
 * Pass `options` to override hardware backend (CPU/GPU/AUTO) or KV-cache size.
 * Falls back to AUTO + 2048 tokens, which lets the native side pick CPU for
 * any model larger than ~1.5 GB on disk (Gemma 2B / 4B). Bump down to 1024
 * if you see native OOM on lower-RAM phones.
 */
export async function ensureEngine(options: GemmaEngineOptions = {}): Promise<string> {
  if (!GEMMA_NATIVE_AVAILABLE) {
    throw new Error("当前平台不支持 CareMind 本地推理。");
  }
  const filename = await resolveSelectedModelFilename();
  if (!filename) {
    throw new Error("尚未选择本地模型。");
  }
  let entry = getModelEntry(filename);
  if (entry.status === "checking") {
    await refreshModelStatus(filename);
    entry = getModelEntry(filename);
  }
  if (entry.status !== "ready") {
    throw new Error("当前选中的本地模型未就绪。");
  }
  await Gemma.initEngine(filename, options);
  return filename;
}

// ---------------------------------------------------------------------------
// Wire up once at module load: native progress events + selected-model sync
// ---------------------------------------------------------------------------

let progressSub: { remove: () => void } | null = null;

function attachProgress() {
  if (progressSub || !GEMMA_NATIVE_AVAILABLE) return;
  progressSub = subscribeDownloadProgress((event) => {
    patchEntry(event.filename, {
      bytesDownloaded: event.bytesDownloaded,
      totalBytes: event.totalBytes,
      progress: event.ratio
    });
  });
}

// Mirror the selected-model singleton into manager state so subscribers get
// re-renders when the user picks a different model in the settings UI.
subscribeSelectedModelId((id) => {
  patchManager({ selectedModelId: id });
});

attachProgress();
if (GEMMA_NATIVE_AVAILABLE) {
  // Schedule an initial catalog fetch + status check without blocking import.
  void refreshAllFromCatalog();
}

/** React hook over the manager. */
export function useManagerState(): ManagerState {
  const [value, setValue] = useState<ManagerState>(state);
  useEffect(() => subscribeManager(setValue), []);
  return value;
}

/** React hook for a single model entry. */
export function useModelEntry(filename: string | null | undefined): PerModelState | null {
  const [value, setValue] = useState<PerModelState | null>(
    filename ? getModelEntry(filename) : null
  );
  useEffect(() => {
    if (!filename) {
      setValue(null);
      return;
    }
    setValue(getModelEntry(filename));
    return subscribeManager((s) => setValue(s.byModel[filename] ?? emptyEntry(filename)));
  }, [filename]);
  return value;
}

/** Convenience: trigger an explicit catalog refresh (used by pull-to-refresh in UI). */
export async function refreshCatalogNow(): Promise<ModelCatalogEntry[]> {
  return refreshAllFromCatalog();
}

/** Auto-select the safest recommended model if no selection has been made. */
export async function ensureSelectionFromCatalog(catalog: ModelCatalogEntry[]): Promise<void> {
  const preferred = preferredModelId(catalog);
  if (state.selectedModelId) {
    // If the persisted selection is no longer in the catalog, move to the
    // recommended lightweight model. Older APKs could persist E2B/E4B; migrate
    // those away as well because they are the most common source of OOM exits.
    const exists = catalog.some((m) => m.id === state.selectedModelId);
    if (!exists && preferred) {
      await setSelectedModelId(preferred);
    } else if (!exists) {
      await setSelectedModelId(null);
    } else if (HIGH_RISK_MODEL_IDS.has(state.selectedModelId) && preferred && preferred !== state.selectedModelId) {
      await setSelectedModelId(preferred);
    }
    return;
  }
  if (preferred) {
    await setSelectedModelId(preferred);
  }
}

/** Convenience re-export so PrivacyModeCard can stay in this file's API. */
export { findModelById };
export type { ModelCatalogEntry };
