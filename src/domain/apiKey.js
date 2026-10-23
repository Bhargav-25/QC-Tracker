import { timingSafeEqual } from "node:crypto";

function headerValue(headers, name) {
  if (!headers) return "";
  const raw = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0] == null ? "" : String(raw[0]);
  return raw == null ? "" : String(raw);
}

// Same header rules as the orders API: Authorization Bearer, otherwise X-API-Key.
export function presentedApiKey(headers) {
  const authorization = headerValue(headers, "authorization");
  if (authorization.toLowerCase().startsWith("bearer ")) {
    return authorization.slice(7).trim();
  }
  return headerValue(headers, "x-api-key").trim();
}

// Constant-time compare. A different length still runs a compare so the
// missing-key and wrong-key paths are not a short-circuit on the secret.
// An empty expected key never matches (the secret is unset).
export function keysMatch(expected, presented) {
  const givenText = String(presented ?? "");
  if (givenText.length > 256) return false;
  const stored = Buffer.from(String(expected ?? ""), "utf8");
  const given = Buffer.from(givenText, "utf8");
  if (stored.length === 0 || given.length === 0) return false;
  if (stored.length !== given.length) {
    timingSafeEqual(given, Buffer.alloc(given.length));
    return false;
  }
  return timingSafeEqual(stored, given);
}
