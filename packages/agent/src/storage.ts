import { RegistryError } from "./types.js";

/**
 * Fetch and JSON-parse from an HTTP/HTTPS URL.
 */
export async function fetchJSON<T>(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new RegistryError(
      "STORAGE_ERROR",
      `Fetch failed for ${url}: ${response.status}`,
    );
  }
  try {
    return (await response.json()) as T;
  } catch (err) {
    throw new RegistryError(
      "INVALID_METADATA",
      `JSON decode failed for ${url}: ${String(err)}`,
      err,
    );
  }
}
