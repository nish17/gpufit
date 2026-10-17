import type { DeviceSpec, RuntimeOptions } from "./estimator/types";

export const PROFILE_KEY = "gpufit.profile.v1";
export const DEFAULT_DEVICE = "rtx-4060-ti-16gb";

export interface Profile {
  deviceId: string;
  memoryGb: number;
  systemRamGb: number;
  ramBandwidthGBps: number;
  drivesDisplay: boolean;
}

export const RAM_PRESETS = [
  { id: "ddr4-3200", label: "DDR4-3200 dual-channel", gbps: 51.2 },
  { id: "ddr5-4800", label: "DDR5-4800 dual-channel", gbps: 76.8 },
  { id: "ddr5-5600", label: "DDR5-5600 dual-channel", gbps: 89.6 },
  { id: "ddr5-6000", label: "DDR5-6000 dual-channel", gbps: 96 },
  { id: "ddr5-6400", label: "DDR5-6400 dual-channel", gbps: 102.4 },
  { id: "lpddr5x", label: "Laptop LPDDR5X (~120 GB/s)", gbps: 120 },
] as const;

export const SYSTEM_RAM_OPTIONS = [16, 32, 64, 128, 256];

export function defaultProfile(device: DeviceSpec): Profile {
  return {
    deviceId: device.slug,
    memoryGb: device.defaultMemoryGb,
    systemRamGb: device.kind === "gpu" ? 32 : device.defaultMemoryGb,
    ramBandwidthGBps: device.kind === "gpu" ? 89.6 : device.bandwidthGBps,
    drivesDisplay: device.drivesDisplayDefault,
  };
}

export function toOptions(profile: Profile): RuntimeOptions {
  return {
    memoryGb: profile.memoryGb,
    systemRamGb: profile.systemRamGb,
    ramBandwidthGBps: profile.ramBandwidthGBps,
    drivesDisplay: profile.drivesDisplay,
  };
}

export function readProfile(): Profile | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Profile;
    if (!parsed?.deviceId || !parsed.memoryGb) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeProfile(profile: Profile) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}
