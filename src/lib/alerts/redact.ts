/** Strip addresses and credential-shaped tokens before anything is written to a log. */
export function redactLogText(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted]")
    .replace(/\bre_[A-Za-z0-9_]+\b/g, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
}
