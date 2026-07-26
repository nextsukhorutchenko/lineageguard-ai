import { expect, it } from "vitest";
import { noStoreHeaders } from "./response-headers.js";

it("preserves mandatory no-store browser protections when callers add response metadata", () => {
  const headers = noStoreHeaders({
    "cache-control": "private",
    "content-type": "application/json; charset=utf-8",
    "referrer-policy": "unsafe-url",
    "x-content-type-options": "override",
    "x-frame-options": "SAMEORIGIN",
  });

  expect(Object.fromEntries(headers)).toMatchObject({
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  });
});
