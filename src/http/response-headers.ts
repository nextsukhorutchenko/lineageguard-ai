export const NO_STORE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
});

export const PUBLIC_BROWSER_HEADERS: readonly {
  readonly key: string;
  readonly value: string;
}[] = Object.freeze(
  Object.entries(NO_STORE_HEADERS).map(([key, value]) => Object.freeze({ key, value })),
);

export function noStoreHeaders(additions: Readonly<Record<string, string>> = {}): Headers {
  const headers = new Headers(additions);
  for (const [key, value] of Object.entries(NO_STORE_HEADERS)) headers.set(key, value);
  return headers;
}
