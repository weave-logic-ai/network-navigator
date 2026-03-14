const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

function transformKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map(transformKeys);
  }
  if (obj !== null && typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([key, value]) => [
        snakeToCamel(key),
        transformKeys(value),
      ])
    );
  }
  return obj;
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(
      data?.error || `Request failed: ${res.status}`,
      res.status,
      data
    );
  }
  const json = await res.json();
  return transformKeys(json) as T;
}

export async function apiPost<T>(
  path: string,
  body?: unknown
): Promise<T> {
  const isFormData = body instanceof FormData;
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: isFormData ? {} : { "Content-Type": "application/json" },
    body: isFormData ? body : body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(
      data?.error || `Request failed: ${res.status}`,
      res.status,
      data
    );
  }
  const json = await res.json();
  return transformKeys(json) as T;
}
