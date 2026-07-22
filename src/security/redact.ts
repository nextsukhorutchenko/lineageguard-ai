const secretKey = /(token|password|secret|authorization|api[_-]?key|private[_-]?key)/i;

export function redact(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === "string") {
    return secrets
      .filter((secret) => secret.length > 0)
      .toSorted((left, right) => right.length - left.length || left.localeCompare(right, "en-US"))
      .reduce((text, secret) => text.replaceAll(secret, "[REDACTED]"), value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, secrets));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        secretKey.test(key) ? "[REDACTED]" : redact(item, secrets),
      ]),
    );
  }

  return value;
}
