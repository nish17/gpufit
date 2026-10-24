import { estimate } from "../estimator/estimate";
import type { DeviceSpec, ModelSpec } from "../estimator/types";

const DAY_MS = 86_400_000;

export interface AlertSubscriber {
  id: string;
  email: string;
  deviceId: string;
  memoryGb: number;
  systemRamGb: number;
  ramBandwidthGBps: number;
  drivesDisplay: boolean;
  weeklyDigest: boolean;
  confirmed: boolean;
}

export interface SentAlert {
  subscriberId: string;
  modelId: string;
}

export interface PlannedHit {
  model: ModelSpec;
  label: string;
  quantId: string | null;
  tokPerSec: [number, number] | null;
}

export interface PlannedMail {
  subscriber: AlertSubscriber;
  deviceName: string;
  hits: PlannedHit[];
}

function freshStamp(model: ModelSpec): number {
  return Date.parse(model.firstSeen || model.createdAt || "");
}

/** Confirmed subscribers, newly tracked models that fit, skipping pairs already mailed. */
export function planAlertMails(input: {
  subscribers: AlertSubscriber[];
  models: ModelSpec[];
  devices: DeviceSpec[];
  alreadySent: SentAlert[];
  now?: number;
  days?: number;
  limit?: number;
}): PlannedMail[] {
  const now = input.now ?? Date.now();
  const cutoff = now - (input.days ?? 14) * DAY_MS;
  const limit = input.limit ?? 8;
  const sent = new Set(input.alreadySent.map((item) => `${item.subscriberId}::${item.modelId}`));
  const fresh = input.models.filter((model) => {
    const stamp = freshStamp(model);
    return Number.isFinite(stamp) && stamp >= cutoff;
  });
  const mails: PlannedMail[] = [];

  for (const subscriber of input.subscribers) {
    if (!subscriber.confirmed) continue;
    const device = input.devices.find((item) => item.slug === subscriber.deviceId);
    if (!device) continue;
    const hits: (PlannedHit & { bucket: string; paramsB: number })[] = [];
    for (const model of fresh) {
      if (sent.has(`${subscriber.id}::${model.id}`)) continue;
      const fit = estimate(model, device, {
        memoryGb: subscriber.memoryGb,
        systemRamGb: subscriber.systemRamGb,
        ramBandwidthGBps: subscriber.ramBandwidthGBps,
        drivesDisplay: subscriber.drivesDisplay,
      });
      if (fit.bucket === "no") continue;
      hits.push({
        model,
        label: fit.label,
        quantId: fit.quant?.id ?? null,
        tokPerSec: fit.tokPerSec,
        bucket: fit.bucket,
        paramsB: model.paramsB,
      });
    }
    hits.sort((a, b) => {
      const rank = (bucket: string) => (bucket === "full" ? 0 : 1);
      return rank(a.bucket) - rank(b.bucket) || b.paramsB - a.paramsB;
    });
    const kept = hits.slice(0, limit);
    if (!kept.length) continue;
    mails.push({
      subscriber,
      deviceName: device.name,
      hits: kept.map(({ model, label, quantId, tokPerSec }) => ({ model, label, quantId, tokPerSec })),
    });
  }
  return mails;
}

export function renderFitMail(mail: PlannedMail, origin: string, unsubscribeUrl: string): { subject: string; text: string } {
  const count = mail.hits.length;
  const subject = count === 1 ? `A new model fits your ${mail.deviceName}` : `${count} new models fit your ${mail.deviceName}`;
  const lines = mail.hits.map((hit) => {
    const quant = hit.quantId ? `, ${hit.quantId}` : "";
    const speed = hit.tokPerSec ? `, about ${Math.round(hit.tokPerSec[0])}–${Math.round(hit.tokPerSec[1])} tok/s` : "";
    return `${hit.model.name} — ${hit.label}${quant}${speed}\n${origin}/models/${hit.model.slug}`;
  });
  const text = [
    `Newly tracked models that fit a ${mail.deviceName}:`,
    "",
    ...lines,
    "",
    "This is an estimate for llama.cpp, not a benchmark.",
    "",
    `Unsubscribe:\n${unsubscribeUrl}`,
    "",
  ].join("\n");
  return { subject, text };
}
