import { GiB } from "./constants";

export function formatGB(bytes: number): string {
  if (!Number.isFinite(bytes)) return "—";
  const gb = bytes / GiB;
  const digits = gb >= 10 ? 1 : 2;
  return `${gb.toFixed(digits)} GB`;
}

export function formatContext(tokens: number): string {
  if (tokens >= 1024 && tokens % 1024 === 0) {
    const k = tokens / 1024;
    return k >= 100 ? `${Math.round(k)}K` : `${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}K`;
  }
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`;
  return String(tokens);
}

export function formatTok(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value >= 100) return String(Math.round(value));
  if (value >= 10) return value.toFixed(0);
  return value.toFixed(1);
}

export function formatTokRange(range: [number, number]): string {
  return `${formatTok(range[0])}–${formatTok(range[1])}`;
}

export function formatParams(paramsB: number): string {
  if (paramsB >= 10) return `${paramsB.toFixed(paramsB >= 100 ? 0 : 1)}B`;
  return `${paramsB.toFixed(paramsB >= 1 ? 1 : 2)}B`;
}
