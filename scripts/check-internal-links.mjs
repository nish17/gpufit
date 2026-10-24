import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function walk(dir, out = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else out.push(full);
  }
  return out;
}

function routeOf(root, file) {
  const rel = path.relative(root, file).split(path.sep).join("/");
  if (rel === "index.html") return "/";
  if (rel.endsWith("/index.html")) return `/${rel.slice(0, -"index.html".length)}`;
  return `/${rel}`;
}

function normalize(raw) {
  if (!raw || raw.startsWith("#") || raw.startsWith("mailto:") || raw.startsWith("javascript:")) return null;
  let url;
  try {
    url = new URL(raw, "https://gpufit.tech");
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.hostname !== "gpufit.tech") return null;
  let pathname = decodeURIComponent(url.pathname);
  const ext = path.posix.extname(pathname);
  if (pathname.length > 1 && !ext && !pathname.endsWith("/")) pathname += "/";
  return pathname;
}

const root = (await exists("dist/index.html")) ? "dist" : (await exists("dist/client/index.html")) ? "dist/client" : "";
if (!root) {
  console.error("check-internal-links: no dist/index.html. Run the build first.");
  process.exit(1);
}

const files = await walk(root);
const routes = new Set(files.map((file) => routeOf(root, file)));
const anchors = new Set();
const broken = [];

for (const file of files.filter((item) => item.endsWith(".html"))) {
  const html = await readFile(file, "utf8");
  for (const match of html.matchAll(/<a\b[^>]*\bhref="([^"]+)"/gi)) {
    const pathname = normalize(match[1]);
    if (!pathname) continue;
    anchors.add(pathname);
    if (!routes.has(pathname)) broken.push(`${routeOf(root, file)} → ${pathname}`);
  }
}

const sitemapFiles = files.filter((file) => path.basename(file).startsWith("sitemap") && file.endsWith(".xml"));
const sitemapUrls = [];
for (const file of sitemapFiles) {
  const xml = await readFile(file, "utf8");
  for (const match of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    const pathname = normalize(match[1]);
    if (pathname && !pathname.endsWith(".xml") && !pathname.endsWith(".xml/")) sitemapUrls.push(pathname);
  }
}

const missingPages = sitemapUrls.filter((pathname) => !routes.has(pathname));
const orphans = sitemapUrls.filter((pathname) => pathname !== "/" && !anchors.has(pathname));
const utility = ["/alerts/confirm/", "/alerts/unsubscribe/"];
const indexedUtility = utility.filter((pathname) => sitemapUrls.includes(pathname));
const indexableUtility = [];
for (const pathname of utility) {
  const file = path.join(root, pathname, "index.html");
  if (!(await exists(file))) continue;
  const html = await readFile(file, "utf8");
  if (!/noindex/i.test(html)) indexableUtility.push(pathname);
}

const problems = [
  ...broken.slice(0, 30).map((line) => `broken ${line}`),
  ...missingPages.slice(0, 10).map((line) => `sitemap missing page ${line}`),
  ...orphans.slice(0, 20).map((line) => `orphan sitemap url ${line}`),
  ...indexedUtility.map((line) => `utility page still in sitemap ${line}`),
  ...indexableUtility.map((line) => `utility page missing noindex ${line}`),
];

if (broken.length || missingPages.length || orphans.length || indexedUtility.length || indexableUtility.length) {
  console.error(`check-internal-links: ${broken.length} broken, ${orphans.length} orphans, ${missingPages.length} missing, ${indexedUtility.length} indexed utility`);
  console.error(problems.join("\n"));
  process.exit(1);
}

if (!routes.has("/rss.xml") && !routes.has("/rss.xml/")) {
  console.error("check-internal-links: /rss.xml was not built");
  process.exit(1);
}
if (!routes.has("/feed.xml") && !routes.has("/feed.xml/")) {
  console.error("check-internal-links: /feed.xml was not built");
  process.exit(1);
}
if (!routes.has("/og/default.png")) {
  console.error("check-internal-links: /og/default.png was not built");
  process.exit(1);
}

console.log(`check-internal-links: ${routes.size} routes, ${sitemapUrls.length} sitemap urls, ${anchors.size} internal targets`);
