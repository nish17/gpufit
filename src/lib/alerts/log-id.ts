import { createHash } from "node:crypto";
import { redactLogText } from "./redact";

/** Short id for logs. Stable for one address, not reversible from the log line. */
export function alertLogId(email: string): string {
  return createHash("sha256").update(`gpufit-alert:${email.trim().toLowerCase()}`).digest("hex").slice(0, 12);
}

export function dryRunSubscriberLine(email: string, deviceName: string): string {
  return `subscriber ${alertLogId(email)} · ${deviceName}`;
}

export function deliveryLogLine(modelCount: number, email: string): string {
  const noun = modelCount === 1 ? "model" : "models";
  return `Sent ${modelCount} ${noun} to subscriber ${alertLogId(email)}`;
}

export function deliveryFailureLine(email: string, message: string): string {
  return `subscriber ${alertLogId(email)}: ${redactLogText(message)}`;
}
