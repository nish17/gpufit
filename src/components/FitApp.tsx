import { useEffect, useMemo, useState } from "react";
import { devices, isSeoPair, models } from "../lib/catalog";
import { hintSlug, webglRenderer } from "../lib/gpu-hint";
import { estimate, formatContext, formatParams, formatTokRange } from "../lib/estimator";
import { bestPicks, compareForMachine } from "../lib/ranking";
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
const INITIAL_ROWS = 15;
const MORE_ROWS = 20;
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
  return <FitAppInner />;
}

function FitAppInner() {
  const [profile, setProfile] = useState<Profile>(() => defaultProfile(findDevice("rtx-4060-ti-16gb")));
  const [saved, setSaved] = useState(false);
  const [hint, setHint] = useState("");
  const [deviceQuery, setDeviceQuery] = useState("");
  const [vendor, setVendor] = useState("all");
  const [modelQuery, setModelQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("fit");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(INITIAL_ROWS);

  useEffect(() => {
    setVisibleCount(INITIAL_ROWS);
  }, [modelQuery, filter, sort, profile.deviceId, profile.memoryGb, profile.systemRamGb, profile.ramBandwidthGBps, profile.drivesDisplay]);

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

  const scored = useMemo(
    () => models.map((model) => ({ model, fit: estimate(model, device, options) })),
    [device, profile.memoryGb, profile.systemRamGb, profile.ramBandwidthGBps, profile.drivesDisplay],
  );
  const picks = useMemo(() => bestPicks(scored), [scored]);

  const ranked = useMemo(() => {
    const query = modelQuery.trim().toLowerCase();
    const filtered = scored.filter(({ fit, model }) => {
      if (query && !`${model.name} ${model.architecture} ${model.useCases.join(" ")}`.toLowerCase().includes(query)) return false;
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
      return compareForMachine(a, b);
    });
    return filtered;
  }, [scored, modelQuery, filter, sort]);

  const fullCount = ranked.filter((row) => row.fit.bucket === "full").length;

  async function detect() {
    setHint("");
    const parts: string[] = [];
    try {
      const gpu = (navigator as Navigator & { gpu?: { requestAdapter: (options?: { powerPreference?: string }) => Promise<{ info?: { vendor?: string; architecture?: string; device?: string; description?: string }; requestAdapterInfo?: () => Promise<{ description?: string; vendor?: string; device?: string }> } | null> } }).gpu;
      if (gpu) {
        const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
        const info = adapter?.info ?? (await adapter?.requestAdapterInfo?.());
        parts.push(info?.vendor ?? "", info?.device ?? "", info?.description ?? "", info?.architecture ?? "");
      }
    } catch {
      // WebGPU can refuse the name. WebGL below is the useful fallback.
    }
    parts.push(webglRenderer());
    const slug = hintSlug(parts.join(" "));
    const match = slug ? devices.find((item) => item.slug === slug) : undefined;
    if (!match) {
      const mac = /mac os|macintosh/i.test(navigator.userAgent);
      setHint(
        mac
          ? "This looks like a Mac, but the chip name was hidden. Pick an M-series chip from the list. Browsers never report memory size."
          : "This browser hid the graphics chip name, so nothing was selected. Pick the card from the list. VRAM is never included.",
      );
      return;
    }
    selectDevice(match);
    setHint(`Pre-selected ${match.name}. Browsers do not report memory size, so confirm it.`);
  }

  const shown = ranked.slice(0, visibleCount);
  const remaining = ranked.length - shown.length;
  const countLabel = ranked.length === 0
    ? "0 models"
    : shown.length === ranked.length
      ? `Showing all ${ranked.length} ${ranked.length === 1 ? "model" : "models"}`
      : `Showing ${shown.length} of ${ranked.length} models`;

  const picker = (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
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
      <div className="device-list grid min-h-0 gap-1 overflow-auto pr-1">
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
      <aside className="picker-panel card hidden p-4 lg:sticky lg:top-20 lg:flex lg:max-h-[calc(100dvh-6.5rem)] lg:flex-col">{picker}</aside>
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

        {picks.length > 0 ? (
          <div className="grid gap-3">
            <div>
              <h2 className="m-0 text-2xl">Best models for your {device.name}</h2>
              <p className="m-0 mt-1 text-sm text-[var(--muted)]">
                The largest checkpoints that still fit fully at about 10 tok/s or faster. Open the Small filter for the tiny ones.
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {picks.map((pick) => (
                <a key={pick.role} href={`/models/${pick.model.slug}/`} className="card grid gap-1 p-3 no-underline">
                  <span className="kicker">{pick.roleLabel}</span>
                  <span className="text-lg font-semibold leading-tight">{pick.model.name}</span>
                  <span className="flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]">
                    <span className={`pill ${TONE[pick.fit.verdict]}`}>{pick.fit.label}</span>
                    <span>
                      {pick.fit.quant?.id ?? "—"}
                      {pick.fit.tokPerSec ? ` · ${formatTokRange(pick.fit.tokPerSec)} tok/s` : ""}
                    </span>
                  </span>
                </a>
              ))}
            </div>
          </div>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row">
          <Input value={modelQuery} onChange={(event) => setModelQuery(event.target.value)} placeholder="Filter models" aria-label="Filter models" />
          <select className="select sm:w-56" value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort models">
            <option value="fit">Best for this machine</option>
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
          {countLabel} · {fullCount} fit fully on this profile. Estimate from memory bandwidth, not a benchmark.{" "}
          <a href="/how-it-works/">How it works</a>.
        </p>
        <div className="grid gap-2">
          {ranked.length === 0 ? (
            <div className="card p-6 text-sm text-[var(--muted)]">Nothing in the catalog matches that filter.</div>
          ) : (
            shown.map(({ model, fit }) => <ModelRow key={model.slug} model={model} fit={fit} device={device} />)
          )}
        </div>
        {remaining > 0 ? (
          <div>
            <Button type="button" variant="outline" onClick={() => setVisibleCount((count) => count + MORE_ROWS)}>
              Show {Math.min(MORE_ROWS, remaining)} more
            </Button>
          </div>
        ) : null}
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
            <a href={`/models/${model.slug}/`}>{model.name}</a>
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
          {fit.tokPerSec ? <div className="text-xs text-[var(--muted)]">Estimate from memory bandwidth, not a benchmark</div> : null}
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
            <a className="text-sm" href={`/can-i-run/${model.slug}/on/${device.slug}/`}>Open the full “can I run” page</a>
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

