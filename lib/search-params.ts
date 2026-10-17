/** Next.js searchParams values may be repeated; use a safe bounded first value. */
export function normalizedQueryParam(input: unknown, limit: number): string {
  const candidate = Array.isArray(input) ? input[0] : input;
  return typeof candidate === "string" ? candidate.slice(0, limit).trim() : "";
}
