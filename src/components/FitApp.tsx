import { useEffect, useMemo, useState } from "react";
import { devices, isSeoPair, models } from "../lib/catalog";
import { compareFits, estimate, formatContext, formatParams, formatTokRange } from "../lib/estimator";
import type { DeviceSpec, FitResult, ModelSpec, VerdictId } from "../lib/estimator/types";
import {
  RAM_PRESETS,
  SYSTEM_RAM_OPTIONS,
  defaultProfile,
  readProfile,
  toOptions,
  writeProfile,
  type Profile,
} from "../lib/profile";
import AlertForm from "./AlertForm";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "./ui/dialog";
import { Input } from "./ui/input";

const QUICK = ["rtx-4060-ti-16gb", "rtx-3060-12gb", "rtx-4090", "rtx-5090", "m5", "m4-pro", "cpu-ddr5-5600"];
const TONE: Record<VerdictId, string> = {
  great: "tone-great",
  runs: "tone-runs",
  tight: "tone-tight",
  raise_limit: "tone-raise_limit",
  moe_offload: "tone-moe_offload",
  offload: "tone-offload",
  cpu: "tone-cpu",
  wont_fit: "tone-wont_fit",
};

function findDevice(id: string): DeviceSpec {
  return devices.find((device) => device.slug === id) ?? devices[0];
}

export default function FitApp() {
  const [profile, setProfile] = useState<Profile>(() => defaultProfile(findDevice("rtx-4060-ti-16gb")));
  const [saved, setSaved] = useState(false);
  const [hint, setHint] = useState("");
  const [deviceQuery, setDeviceQuery] = useState("");
  const [vendor, setVendor] = useState("all");
  const [modelQuery, setModelQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("fit");
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    const stored = readProfile();
    if (!stored) return;
    if (!devices.some((device) => device.slug === stored.deviceId)) return;
    setProfile(stored);
    setSaved(true);
  }, []);

  function update(next: Profile, persist = true) {
    setProfile(next);
    if (persist) {
      writeProfile(next);
      setSaved(true);
    }
  }

  function selectDevice(device: DeviceSpec) {
    const next = defaultProfile(device);
    next.systemRamGb = device.kind === "gpu" ? profile.systemRamGb : device.defaultMemoryGb;
    next.ramBandwidthGBps = device.kind === "gpu" ? profile.ramBandwidthGBps : device.bandwidthGBps;
    next.drivesDisplay = device.drivesDisplayDefault;
    update(next);
    setPickerOpen(false);
  }

  const device = findDevice(profile.deviceId);
  const options = toOptions(profile);

  const ranked = useMemo(() => {
    const query = modelQuery.trim().toLowerCase();
    const rows = models
      .filter((model) => {
        if (!query) return true;
        return `${model.name} ${model.architecture} ${model.useCases.join(" ")}`.toLowerCase().includes(query);
      })
      .map((model) => ({ model, fit: estimate(model, device, options) }));
    const filtered = rows.filter(({ fit, model }) => {
      if (filter === "full") return fit.bucket === "full";
      if (filter === "offload") return fit.bucket === "offload" || fit.bucket === "limit";
      if (filter === "no") return fit.bucket === "no";
      if (filter === "all") return true;
      return model.useCases.includes(filter);
    });
    filtered.sort((a, b) => {
      if (sort === "speed") return (b.fit.tokPerSec?.[1] ?? -1) - (a.fit.tokPerSec?.[1] ?? -1);
      if (sort === "newest") return Date.parse(b.model.createdAt || "") - Date.parse(a.model.createdAt || "");
      if (sort === "downloads") return (b.model.downloads ?? 0) - (a.model.downloads ?? 0);
      return compareFits(a.fit, b.fit);
    });
    return filtered;
  }, [device, profile.memoryGb, profile.systemRamGb, profile.ramBandwidthGBps, profile.drivesDisplay, modelQuery, filter, sort]);

  const fullCount = ranked.filter((row) => row.fit.bucket === "full").length;

  async function detect() {
    setHint("");
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<{ info?: { vendor?: string; architecture?: string; device?: string; description?: string }; requestAdapterInfo?: () => Promise<{ description?: string; vendor?: string; device?: string }> } | null> } }).gpu;
    if (!gpu) {
      setHint("This browser did not expose WebGPU. Pick the card yourself — VRAM is never reported here.");
      return;
    }
    try {
      const adapter = await gpu.requestAdapter();
      const info = adapter?.info ?? (await adapter?.requestAdapterInfo?.());
      const text = `${info?.vendor ?? ""} ${info?.device ?? ""} ${info?.description ?? ""} ${info?.architecture ?? ""}`.toLowerCase();
      const match = hintMatch(text);
      if (!match) {
        setHint(`Saw “${text.trim() || "an unknown adapter"}”, but it did not match the list. VRAM is not included in that string.`);
        return;
      }
      selectDevice(match);
      setHint(`Pre-selected ${match.name}. Browsers do not report VRAM, so confirm the memory size.`);
    } catch {
      setHint("GPU detection was blocked. Pick the card from the list.");
    }
  }

  const picker = (
    <div className="grid gap-3">
      <Input value={deviceQuery} onChange={(event) => setDeviceQuery(event.target.value)} placeholder="Search GPUs, Macs, CPUs" aria-label="Search hardware" />
      <div className="flex flex-wrap gap-1.5">
        {[
          ["all", "All"],
          ["nvidia", "NVIDIA"],
          ["amd", "AMD"],
          ["intel", "Intel"],
          ["apple", "Apple"],
          ["cpu", "CPU"],
        ].map(([id, label]) => (
          <button key={id} className="chip" aria-pressed={vendor === id} onClick={() => setVendor(id)} type="button">
            {label}
          </button>
        ))}
      </div>
      <div className="grid max-h-72 gap-1 overflow-auto pr-1">
        {devices
          .filter((item) => inGroup(item, vendor))
          .filter((item) => item.name.toLowerCase().includes(deviceQuery.trim().toLowerCase()))
          .map((item) => (
            <button
              key={item.slug}
              type="button"
              onClick={() => selectDevice(item)}
              className="flex items-center justify-between rounded-xl border border-transparent px-2 py-2 text-left hover:border-[var(--line)] hover:bg-[var(--bg)]"
              style={item.slug === device.slug ? { borderColor: "var(--line)", background: "var(--bg)" } : undefined}
            >
              <span>
                <span className="block text-sm font-medium">{item.name}</span>
                <span className="block text-xs text-[var(--muted)]">{memoryLabel(item)} · {item.bandwidthGBps} GB/s</span>
              </span>
            </button>
          ))}
      </div>
      <Button type="button" variant="outline" onClick={detect}>
        Try a browser hint
      </Button>
      {hint ? <p className="m-0 text-xs text-[var(--muted)]">{hint}</p> : null}
      {device.memoryOptionsGb ? (
        <label className="grid gap-1 text-sm">
          Memory
          <select
            className="select"
            value={profile.memoryGb}
            onChange={(event) => update({ ...profile, memoryGb: Number(event.target.value) })}
          >
            {device.memoryOptionsGb.map((gb) => (
              <option key={gb} value={gb}>{gb} GB</option>
            ))}
          </select>
        </label>
      ) : null}
      {device.kind === "gpu" ? (
        <div className="grid gap-2">
          <label className="grid gap-1 text-sm">
            System RAM for offload
            <select className="select" value={profile.systemRamGb} onChange={(event) => update({ ...profile, systemRamGb: Number(event.target.value) })}>
              {SYSTEM_RAM_OPTIONS.map((gb) => (
                <option key={gb} value={gb}>{gb} GB</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            RAM bandwidth
            <select
              className="select"
              value={profile.ramBandwidthGBps}
              onChange={(event) => update({ ...profile, ramBandwidthGBps: Number(event.target.value) })}
            >
              {RAM_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.gbps}>{preset.label}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-[var(--muted)]">
            <input
              type="checkbox"
              checked={profile.drivesDisplay}
              onChange={(event) => update({ ...profile, drivesDisplay: event.target.checked })}
            />
            This GPU also drives my display
          </label>
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="card hidden p-4 lg:sticky lg:top-20 lg:block">{picker}</aside>
      <section className="grid gap-4">
        <div className="card grid gap-3 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="kicker m-0">{saved ? "Your machine" : "Example machine"}</p>
              <h2 className="m-0 mt-1 text-3xl">{device.name}</h2>
              <p className="m-0 mt-1 text-sm text-[var(--muted)]">
                {device.kind === "gpu"
                  ? `${device.vramGb} GB ${device.memoryType} · ${device.bandwidthGBps} GB/s · ${profile.systemRamGb} GB system RAM`
                  : `${profile.memoryGb} GB · ${device.bandwidthGBps} GB/s`}
                {saved ? "" : " · pick yours to replace this"}
              </p>
            </div>
            <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" className="lg:hidden">Choose hardware</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogTitle>Choose hardware</DialogTitle>
                <div className="mt-3">{picker}</div>
              </DialogContent>
            </Dialog>
          </div>
          <div className="flex flex-wrap gap-2">
            {QUICK.map((slug) => {
              const item = findDevice(slug);
              return (
                <button key={slug} type="button" className="chip" aria-pressed={slug === device.slug} onClick={() => selectDevice(item)}>
                  {shortName(item)}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Input value={modelQuery} onChange={(event) => setModelQuery(event.target.value)} placeholder="Filter models" aria-label="Filter models" />
          <select className="select sm:w-44" value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort models">
            <option value="fit">Best fit</option>
            <option value="speed">Fastest</option>
            <option value="newest">Newest</option>
            <option value="downloads">Most downloaded</option>
          </select>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[
            ["all", "All"],
            ["full", "Fits"],
            ["offload", "Offload"],
            ["no", "Won't fit"],
            ["chat", "Chat"],
            ["coding", "Coding"],
            ["reasoning", "Reasoning"],
            ["vision", "Vision"],
            ["small", "Small"],
          ].map(([id, label]) => (
            <button key={id} className="chip" aria-pressed={filter === id} type="button" onClick={() => setFilter(id)}>
              {label}
            </button>
          ))}
        </div>
        <p className="m-0 text-sm text-[var(--muted)]">
          {ranked.length} models · {fullCount} fit fully on this profile. Estimates assume llama.cpp, FP16 KV cache, and a bandwidth range.
        </p>
        <div className="grid gap-2">
          {ranked.length === 0 ? (
            <div className="card p-6 text-sm text-[var(--muted)]">Nothing in the catalog matches that filter.</div>
          ) : (
            ranked.map(({ model, fit }) => <ModelRow key={model.slug} model={model} fit={fit} device={device} />)
          )}
        </div>
        <div className="card p-4 sm:p-5">
          <h2 className="m-0 text-2xl">Alerts for this machine</h2>
          <div className="mt-3">
            <AlertForm profile={profile} deviceName={device.name} />
          </div>
        </div>
      </section>
    </div>
  );
}

function ModelRow({ model, fit, device }: { model: ModelSpec; fit: FitResult; device: DeviceSpec }) {
  const [note, setNote] = useState("");
  const [measured, setMeasured] = useState("");
  return (
    <article className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`pill ${TONE[fit.verdict]}`}>{fit.label}</span>
            {model.useCases.slice(0, 3).map((use) => (
              <span key={use} className="text-xs uppercase tracking-wide text-[var(--muted)]">{use}</span>
            ))}
          </div>
          <h3 className="m-0 mt-2 text-2xl">
            <a href={`/models/${model.slug}`}>{model.name}</a>
          </h3>
          <p className="m-0 text-sm text-[var(--muted)]">
            {formatParams(model.paramsB)}
            {model.activeParamsB ? ` · ${formatParams(model.activeParamsB)} active` : ""} · {model.architecture}
            {model.contextLength ? ` · ${formatContext(model.contextLength)} max` : ""}
          </p>
        </div>
        <div className="text-right">
          <div className="text-sm font-semibold">{fit.quant ? fit.quant.id : "—"}</div>
          <div className="text-sm text-[var(--muted)]">
            {fit.context ? `${formatContext(fit.context)} context` : "no context"}
            {fit.tokPerSec ? ` · ${formatTokRange(fit.tokPerSec)} tok/s` : ""}
          </div>
        </div>
      </div>
      <p className="mb-0 mt-3 text-sm">{fit.summary}</p>
      <details className="mt-3">
        <summary className="cursor-pointer text-sm text-[var(--muted)]">Run commands and a speed note</summary>
        <div className="mt-3 grid gap-2">
          <Command label="llama.cpp" text={fit.commands.llamaCpp} />
          {fit.commands.ollama ? <Command label="Ollama" text={fit.commands.ollama} /> : <p className="m-0 text-xs text-[var(--muted)]">No Ollama library match for this repo.</p>}
          <Command label="LM Studio" text={fit.commands.lmStudio} />
          {isSeoPair(model.slug, device.slug) ? (
            <a className="text-sm" href={`/can-i-run/${model.slug}/on/${device.slug}`}>Open the full “can I run” page</a>
          ) : null}
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const value = Number(measured);
              if (!Number.isFinite(value) || value <= 0) return;
              const key = "gpufit.feedback";
              const previous = JSON.parse(localStorage.getItem(key) || "[]");
              previous.push({ model: model.id, device: device.slug, tokPerSec: value, quant: fit.quant?.id, at: new Date().toISOString() });
              localStorage.setItem(key, JSON.stringify(previous));
              setNote("Saved on this machine. A public calibration upload is not wired up yet.");
            }}
          >
            <label className="text-sm text-[var(--muted)]" htmlFor={`speed-${model.slug}`}>My measured tok/s</label>
            <input id={`speed-${model.slug}`} className="field" style={{ width: "6rem" }} inputMode="decimal" value={measured} onChange={(event) => setMeasured(event.target.value)} />
            <button className="btn btn-ghost" type="submit">Save</button>
          </form>
          {note ? <p className="m-0 text-xs text-[var(--muted)]">{note}</p> : null}
        </div>
      </details>
    </article>
  );
}

function Command({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-[var(--muted)]">
        <span>{label}</span>
        <button className="btn btn-ghost" type="button" style={{ padding: "0.2rem 0.6rem" }} data-copy={text}>Copy</button>
      </div>
      <pre className="cmd">{text}</pre>
    </div>
  );
}

function memoryLabel(device: DeviceSpec): string {
  if (device.kind === "gpu") return `${device.vramGb} GB`;
  return device.memoryOptionsGb ? device.memoryOptionsGb.map((gb) => `${gb}`).join("/") + " GB" : `${device.defaultMemoryGb} GB`;
}

function shortName(device: DeviceSpec): string {
  return device.name.replace("GeForce ", "").replace("Radeon ", "").replace("Apple ", "").replace("CPU only · ", "");
}

function inGroup(device: DeviceSpec, vendor: string): boolean {
  if (vendor === "all") return true;
  if (vendor === "apple") return device.vendor === "apple";
  if (vendor === "cpu") return device.kind === "cpu" || device.kind === "unified";
  return device.vendor === vendor && device.kind === "gpu";
}

function hintMatch(text: string): DeviceSpec | null {
  const rules: [RegExp, string][] = [
    [/5090/, "rtx-5090"],
    [/5080/, "rtx-5080"],
    [/5070\s*ti/, "rtx-5070-ti"],
    [/5070/, "rtx-5070"],
    [/5060\s*ti/, "rtx-5060-ti-16gb"],
    [/5060/, "rtx-5060"],
    [/4090/, "rtx-4090"],
    [/4080\s*super/, "rtx-4080-super"],
    [/4080/, "rtx-4080"],
    [/4070\s*ti\s*super/, "rtx-4070-ti-super"],
    [/4070\s*ti/, "rtx-4070-ti"],
    [/4070\s*super/, "rtx-4070-super"],
    [/4070/, "rtx-4070"],
    [/4060\s*ti/, "rtx-4060-ti-16gb"],
    [/4060/, "rtx-4060"],
    [/3090\s*ti/, "rtx-3090-ti"],
    [/3090/, "rtx-3090"],
    [/3080\s*ti/, "rtx-3080-ti"],
    [/3080/, "rtx-3080-10gb"],
    [/3070\s*ti/, "rtx-3070-ti"],
    [/3070/, "rtx-3070"],
    [/3060\s*ti/, "rtx-3060-ti"],
    [/3060/, "rtx-3060-12gb"],
    [/7900\s*xtx/, "rx-7900-xtx"],
    [/7800\s*xt/, "rx-7800-xt"],
    [/9070\s*xt/, "rx-9070-xt"],
    [/b580/, "arc-b580"],
    [/a770/, "arc-a770-16gb"],
    [/m5 max/, "m5-max-40gpu"],
    [/m5 pro/, "m5-pro"],
    [/m4 max/, "m4-max-40gpu"],
    [/m4 pro/, "m4-pro"],
    [/m3 max/, "m3-max-40gpu"],
    [/m3 pro/, "m3-pro"],
    [/m2 max/, "m2-max"],
    [/m1 max/, "m1-max"],
  ];
  for (const [pattern, slug] of rules) {
    if (pattern.test(text)) return devices.find((device) => device.slug === slug) ?? null;
  }
  return null;
}
