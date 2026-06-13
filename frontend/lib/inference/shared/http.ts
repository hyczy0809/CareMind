// Shared HTTP/config plumbing for the cloud inference adapters. Kept here so
// each per-task cloud file stays focussed on its own mapping logic.

import { TRACK_C_OFFLINE_DEMO } from "../track-c-demo";

const DEV_API_BASE_URL =
  process.env.EXPO_PUBLIC_CAREMIND_DEV_API_URL ?? "http://127.0.0.1:8090";
const PRODUCTION_API_BASE_URL = "https://caremind-1039168666325.us-west1.run.app";
const CONFIGURED_API_BASE_URL = process.env.EXPO_PUBLIC_CAREMIND_API_URL?.trim();
const IS_DEV_BUILD =
  typeof __DEV__ !== "undefined" ? __DEV__ : process.env.NODE_ENV !== "production";

export const API_BASE_URL = normalizeApiBaseUrl(
  CONFIGURED_API_BASE_URL || (IS_DEV_BUILD ? DEV_API_BASE_URL : PRODUCTION_API_BASE_URL)
);

export const API_BASE_SOURCE = CONFIGURED_API_BASE_URL
  ? "env"
  : IS_DEV_BUILD
    ? "dev-default"
    : "production-default";

export const REQUEST_TIMEOUT_MS = 12000;
const TRACK_C_BLOCKED_PREFIXES = [
  "/api/audio",
  "/api/care-workflow",
  "/api/documents",
  "/api/guardrail",
  "/api/reports"
];

export function requireApiBaseUrl(): string {
  if (!API_BASE_URL) {
    throw new Error(
      "CareMind 后端地址未配置。发布移动端安装包前请设置 EXPO_PUBLIC_CAREMIND_API_URL 为已部署的 HTTPS 后端地址。"
    );
  }
  return API_BASE_URL;
}

export function buildApiUrl(path: string): string {
  const base = requireApiBaseUrl();
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  assertTrackCCloudEndpointAllowed(normalizedPath);
  return `${base}${normalizedPath}`;
}

export function assertTrackCCloudEndpointAllowed(path: string): void {
  if (!TRACK_C_OFFLINE_DEMO) return;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (TRACK_C_BLOCKED_PREFIXES.some((prefix) => normalizedPath.startsWith(prefix))) {
    throw new Error(`Track C 离线 demo 禁止调用云端接口：${normalizedPath}`);
  }
}

export async function readableApiError(response: Response, fallback: string): Promise<string> {
  try {
    const payload = (await response.json()) as { detail?: string };
    return payload.detail ? `${fallback}：${payload.detail}` : `${fallback}：${response.status}`;
  } catch {
    return `${fallback}：${response.status}`;
  }
}

export async function postJson<TResponse>(path: string, payload: unknown): Promise<TResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(buildApiUrl(path), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`CareMind API 请求失败：${response.status}`);
    }

    return (await response.json()) as TResponse;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("CareMind 后端响应超时，请确认服务是否已启动。");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeApiBaseUrl(value: string | undefined): string {
  return (value ?? "").replace(/\/+$/, "");
}
