export interface FeedItem {
  title: string;
  link: string;
  description: string;
  date?: string | null;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function rssDocument(opts: { title: string; link: string; description: string; items: FeedItem[] }): string {
  const items = opts.items
    .map((item) => {
      const date = item.date ? new Date(item.date).toUTCString() : new Date().toUTCString();
      return `<item><title>${escapeXml(item.title)}</title><link>${escapeXml(item.link)}</link><guid>${escapeXml(item.link)}</guid><pubDate>${date}</pubDate><description>${escapeXml(item.description)}</description></item>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${escapeXml(opts.title)}</title><link>${escapeXml(opts.link)}</link><description>${escapeXml(opts.description)}</description>${items}</channel></rss>`;
}

export function atomDocument(opts: { title: string; link: string; description: string; items: FeedItem[] }): string {
  const items = opts.items
    .map((item) => {
      const date = item.date ? new Date(item.date).toISOString() : new Date().toISOString();
      return `<entry><title>${escapeXml(item.title)}</title><link href="${escapeXml(item.link)}"/><id>${escapeXml(item.link)}</id><updated>${date}</updated><summary>${escapeXml(item.description)}</summary></entry>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>${escapeXml(opts.title)}</title><link href="${escapeXml(opts.link)}"/><updated>${new Date().toISOString()}</updated><id>${escapeXml(opts.link)}</id><subtitle>${escapeXml(opts.description)}</subtitle>${items}</feed>`;
}
