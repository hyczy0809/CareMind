// Track C competition build mode.
//
// The product can support hybrid edge/cloud routing, but judged Track C demos
// must prove that inference runs fully offline on the device. Keep this mode
// enabled by default for the current mobile build; set
// EXPO_PUBLIC_CAREMIND_TRACK_C_OFFLINE_DEMO=0 only for non-demo hybrid testing.

const RAW_FLAG = (process.env.EXPO_PUBLIC_CAREMIND_TRACK_C_OFFLINE_DEMO ?? "1")
  .trim()
  .toLowerCase();

export const TRACK_C_OFFLINE_DEMO =
  RAW_FLAG !== "0" &&
  RAW_FLAG !== "false" &&
  RAW_FLAG !== "off" &&
  RAW_FLAG !== "no";

export function trackCLabel(): string {
  return TRACK_C_OFFLINE_DEMO ? "Track C offline edge AI demo" : "Hybrid edge-cloud mode";
}
