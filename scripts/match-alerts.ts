/**
 * Dry-run matcher. Reads data/subscribers.json (the local alert store)
 * and prints which confirmed profiles would be mailed about recent models.
 * It does not send email.
 */
import { readFileSync, existsSync } from "node:fs";
import { estimate } from "../src/lib/estimator/index.ts";
import type { DeviceSpec, ModelSpec } from "../src/lib/estimator/types.ts";

const subscribersPath = new URL("../data/subscribers.json", import.meta.url);
const models = JSON.parse(readFileSync(new URL("../src/data/models.json", import.meta.url), "utf8")) as ModelSpec[];
const devices = JSON.parse(readFileSync(new URL("../src/data/hardware.json", import.meta.url), "utf8")) as DeviceSpec[];

if (!existsSync(subscribersPath)) {
  console.log("No data/subscribers.json yet. Nothing to match.");
  process.exit(0);
}

const subscribers = JSON.parse(readFileSync(subscribersPath, "utf8")) as Array<{
  email: string;
  deviceId: string;
  memoryGb: number;
  systemRamGb: number;
  ramBandwidthGBps: number;
  drivesDisplay: boolean;
  confirmed: boolean;
}>;

const cutoff = Date.now() - 14 * 86_400_000;
const recent = models.filter((model) => Date.parse(model.createdAt || "") >= cutoff);
const pool = recent.length ? recent : models.slice(0, 5);

for (const subscriber of subscribers.filter((item) => item.confirmed)) {
  const device = devices.find((item) => item.slug === subscriber.deviceId);
  if (!device) {
    console.log(`${subscriber.email}: unknown device ${subscriber.deviceId}`);
    continue;
  }
  console.log(`\n${subscriber.email} · ${device.name}`);
  for (const model of pool) {
    const fit = estimate(model, device, {
      memoryGb: subscriber.memoryGb,
      systemRamGb: subscriber.systemRamGb,
      ramBandwidthGBps: subscriber.ramBandwidthGBps,
      drivesDisplay: subscriber.drivesDisplay,
    });
    if (fit.bucket === "no") continue;
    console.log(`  would mention ${model.name}: ${fit.label} (${fit.quant?.id ?? "no quant"})`);
  }
}
