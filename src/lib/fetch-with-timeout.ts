const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Fetch wrapper with automatic timeout via AbortSignal.
 * If the caller already provides a signal, it is respected (no extra timeout added).
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit & { timeout?: number }
): Promise<Response> {
  const { timeout = DEFAULT_TIMEOUT_MS, ...options } = init ?? {};

  if (options.signal) {
    return fetch(input, options);
  }

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  try {
    return await fetch(input, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}
