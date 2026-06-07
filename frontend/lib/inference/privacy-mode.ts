import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";

// Stored separately from caremind:v2:state so toggling privacy mode does not
// thrash the entire CareMindProvider, and clearing care data does not flip
// the user's privacy preference.
const STORAGE_KEY = "caremind:v2:privacyMode";
// Which on-device model is currently selected. Stored as a plain string
// (the filename / catalog id). Empty / null ⇒ no selection yet.
const SELECTED_MODEL_KEY = "caremind:v2:selectedModelId";

type Subscriber = (value: boolean) => void;
type SelectedModelSubscriber = (value: string | null) => void;

let cached: boolean = false;
let initialized = false;
let initPromise: Promise<void> | null = null;
const subscribers = new Set<Subscriber>();

let selectedModelCached: string | null = null;
const selectedModelSubs = new Set<SelectedModelSubscriber>();

async function loadFromStorage(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw === "1" || raw === "true";
  } catch (error) {
    console.warn("privacy-mode hydrate failed", error);
    return false;
  }
}

async function loadSelectedModel(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(SELECTED_MODEL_KEY);
    return raw && raw.length > 0 ? raw : null;
  } catch (error) {
    console.warn("selectedModel hydrate failed", error);
    return null;
  }
}

/**
 * Initialise the cached value from AsyncStorage. Call once at app startup
 * (e.g. in app/_layout.tsx) BEFORE any inference call runs, so that
 * isPrivacyModeSync returns the correct value without an await.
 */
export async function initPrivacyMode(): Promise<void> {
  if (initialized) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    cached = await loadFromStorage();
    selectedModelCached = await loadSelectedModel();
    initialized = true;
  })();

  return initPromise;
}

/**
 * Async getter — always returns the freshest value, hydrating cache if needed.
 * The inference router uses this on every dispatch so it is correct even if
 * the user toggled the flag while a long-running call was in flight.
 */
export async function isPrivacyMode(): Promise<boolean> {
  if (!initialized) {
    await initPrivacyMode();
  }
  return cached;
}

/**
 * Synchronous accessor. Safe to use after initPrivacyMode() has resolved
 * (which happens during app startup). Returns false before that, which is
 * the safe default — calls dispatch to cloud, never accidentally to a
 * not-yet-loaded local engine.
 */
export function isPrivacyModeSync(): boolean {
  return cached;
}

export async function setPrivacyMode(value: boolean): Promise<void> {
  const next = !!value;
  cached = next;
  initialized = true;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  } catch (error) {
    console.warn("privacy-mode persist failed", error);
  }
  for (const sub of subscribers) {
    try {
      sub(next);
    } catch (error) {
      console.warn("privacy-mode subscriber threw", error);
    }
  }
}

export function subscribePrivacyMode(cb: Subscriber): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

// ---------- Selected model -------------------------------------------------

/** Synchronous accessor for the currently selected on-device model id (==
 *  filename). Returns null if nothing is chosen yet, in which case callers
 *  should fall back to a default from the catalog. */
export function getSelectedModelIdSync(): string | null {
  return selectedModelCached;
}

export async function getSelectedModelId(): Promise<string | null> {
  if (!initialized) await initPrivacyMode();
  return selectedModelCached;
}

export async function setSelectedModelId(modelId: string | null): Promise<void> {
  const next = modelId && modelId.length > 0 ? modelId : null;
  selectedModelCached = next;
  try {
    if (next === null) {
      await AsyncStorage.removeItem(SELECTED_MODEL_KEY);
    } else {
      await AsyncStorage.setItem(SELECTED_MODEL_KEY, next);
    }
  } catch (error) {
    console.warn("selectedModel persist failed", error);
  }
  for (const sub of selectedModelSubs) {
    try {
      sub(next);
    } catch (error) {
      console.warn("selectedModel subscriber threw", error);
    }
  }
}

export function subscribeSelectedModelId(cb: SelectedModelSubscriber): () => void {
  selectedModelSubs.add(cb);
  return () => {
    selectedModelSubs.delete(cb);
  };
}

/**
 * React hook bound to the same singleton store. Returns the current value
 * plus a setter that persists and broadcasts to all other subscribers.
 */
export function usePrivacyMode(): readonly [boolean, (value: boolean) => Promise<void>] {
  const [value, setValue] = useState<boolean>(isPrivacyModeSync());

  useEffect(() => {
    let cancelled = false;

    if (!initialized) {
      initPrivacyMode()
        .then(() => {
          if (!cancelled) setValue(isPrivacyModeSync());
        })
        .catch(() => {});
    }

    const unsubscribe = subscribePrivacyMode((next) => {
      if (!cancelled) setValue(next);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return [value, setPrivacyMode] as const;
}

export function useSelectedModelId(): readonly [string | null, (id: string | null) => Promise<void>] {
  const [value, setValue] = useState<string | null>(getSelectedModelIdSync());

  useEffect(() => {
    let cancelled = false;
    if (!initialized) {
      initPrivacyMode()
        .then(() => {
          if (!cancelled) setValue(getSelectedModelIdSync());
        })
        .catch(() => {});
    }
    const unsubscribe = subscribeSelectedModelId((next) => {
      if (!cancelled) setValue(next);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return [value, setSelectedModelId] as const;
}
