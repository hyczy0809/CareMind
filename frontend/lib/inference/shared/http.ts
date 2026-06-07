// Shared HTTP/config plumbing for the cloud inference adapters. Kept here so
// each per-task cloud file stays focussed on its own mapping logic.

const DEFAULT_API_BASE_URL = "http://127.0.0.1:8090";

export const API_BASE_URL =
  process.env.EXPO_PUBLIC_CAREMIND_API_URL ?? DEFAULT_API_BASE_URL;

export const REQUEST_TIMEOUT_MS = 12000;

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
    const response = await fetch(`${API_BASE_URL}${path}`, {
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
