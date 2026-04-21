/**
 * Error thrown by `apiFetch` and (by convention) all other web-side fetch paths
 * that hit the quovibe API. Carries the HTTP status and the server's structured
 * error code separately from the human-readable message so the global
 * `MutationCache.onError` handler in `query-client.ts` can translate known
 * codes via i18n instead of surfacing raw server identifiers in toasts.
 *
 * `details` holds whatever extra fields the server returned alongside `error`
 * (e.g. `count` on `security_has_transactions`, Zod issues on validation
 * failures). It is the untyped remainder of the JSON body, so consumers that
 * care about a specific shape must narrow it themselves.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;

  constructor(status: number, code: string, details?: Record<string, unknown>) {
    super(code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * Reads a non-ok `Response` and converts it to an `ApiError`. Shared by
 * `apiFetch` and the raw-`fetch` call sites (multipart uploads, direct DELETE
 * requests) that can't go through `apiFetch` but still need the same error
 * shape to reach `MutationCache.onError`.
 */
export async function toApiError(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const code =
    typeof body['error'] === 'string' && body['error'].length > 0
      ? (body['error'] as string)
      : `HTTP_${res.status}`;
  const { error: _err, ...rest } = body;
  return new ApiError(res.status, code, rest);
}

export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });

  if (!res.ok) throw await toApiError(res);

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
