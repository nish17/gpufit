function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function line(value: string, max: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}

export interface OgCard {
  kicker: string;
  title: string;
  subtitle: string;
  footer: string;
}

/** 1200×630 card. Rasterized at build time; social sites do not accept SVG og:image. */
export function ogCardSvg(card: OgCard): string {
  const title = line(card.title, 42);
  const subtitle = line(card.subtitle, 72);
  const footer = line(card.footer, 64);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <rect width="1200" height="630" fill="#121410"/>
  <rect x="48" y="48" width="1104" height="534" rx="28" fill="#1c2118" stroke="#d6ff4a" stroke-width="3"/>
  <text x="88" y="150" fill="#d6ff4a" font-family="DejaVu Sans, sans-serif" font-size="28" letter-spacing="3">${escapeXml(card.kicker.toUpperCase())}</text>
  <text x="88" y="270" fill="#f4f1ea" font-family="DejaVu Sans, sans-serif" font-size="64">${escapeXml(title)}</text>
  <text x="88" y="360" fill="#c8c2b4" font-family="DejaVu Sans, sans-serif" font-size="32">${escapeXml(subtitle)}</text>
  <text x="88" y="490" fill="#f4f1ea" font-family="DejaVu Sans, sans-serif" font-size="30">${escapeXml(footer)}</text>
</svg>`;
}
