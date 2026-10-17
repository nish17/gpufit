# GPUfit

GPUfit tells you whether an open-source LLM fits on a GPU, a Mac, or a CPU, which quantization to use, how much context is practical, and a tokens-per-second range. The hardware profile stays in the browser. You can sign up to hear when a newly tracked model fits that machine.

The estimator is an estimate for llama.cpp, not a benchmark. The method is written up at `/how-it-works`.

## Local development

Requires Node.js 22.22 or newer.

```bash
npm install
npm run dev
```

The dev server listens on port **47321**.

```bash
npm test          # Vitest estimator tests and Python parser tests
npm run build
npm run preview   # serves the production build on port 47321
```

Refresh the model catalog (works without a token; `HF_TOKEN` raises Hugging Face rate limits):

```bash
# optional: export HF_TOKEN=hf_...
npm run fetch:models
```

That writes `src/data/models.json` and `src/data/fetch-report.json`. Hardware lives in `src/data/hardware.json` and is regenerated with `npm run hardware`.

Alert signups in dev are written to `data/subscribers.json` (gitignored). The form shows a local confirmation link because no email is sent. After you confirm one, a dry run of who would be mailed is:

```bash
npm run alerts:match
```

## Deploy on Cloudflare

The site is static Astro with a few on-demand routes for alerts (`output: 'static'`, `@astrojs/cloudflare`).

```bash
npm run build
npx wrangler deploy
```

`npm run build` prerenders the HTML with Node (so the build does not need a live D1 database). The worker only has to serve those assets and the `/api/alerts` routes.

Set the public origin at build time if it is not `https://gpufit.dev`:

```bash
SITE_URL=https://your-domain.example npm run build
```

Canonical URLs, the sitemap, and `public/robots.txt` assume `https://gpufit.dev` until you change them. That domain was a candidate when this was written; confirm it is available before buying it.

### Scheduled catalog refresh

`.github/workflows/model-watcher.yml` runs `scripts/fetch_models.py` every six hours and pushes `src/data/models.json` when it changes. Give the workflow a `HF_TOKEN` secret if you start hitting Hub rate limits. The default `GITHUB_TOKEN` needs permission to push to the default branch; branch protection that blocks bot pushes should be switched to a pull-request step instead.

Cloudflare cron is a poor fit for this job: the fetch has to commit JSON back to the repo so the static pages rebuild. Keep the scheduler on GitHub Actions.

## Accounts and secrets

Nothing below is created for you. The site builds and the estimator runs with no accounts. Real alert email needs the first three.

| Secret or account | Required for | Notes |
| --- | --- | --- |
| Cloudflare account | Hosting | Workers + static assets. Free tier holds the first few thousand pages; the Workers Paid plan ($5/month) raises the file cap. |
| Domain | Public URL | Register it yourself (Cloudflare Registrar is fine). Point it at the worker. |
| `HF_TOKEN` | Optional | Hugging Face read token. The fetcher works anonymously. |
| `RESEND_API_KEY` | Alert email | [Resend](https://resend.com). Free tier is 100 emails/day. |
| `ALERT_FROM` | Alert email | A sender on a domain you have verified in Resend, for example `GPUfit <alerts@gpufit.dev>`. |
| `ALERT_TOKEN_SECRET` | Alert links | Long random string. Signs confirm and unsubscribe links. The dev default `dev-only-change-me` must not be used in production. |
| Cloudflare D1 database | Alert storage | Create a database named `gpufit`, add a `DB` binding in `wrangler.jsonc`, then `npx wrangler d1 execute gpufit --file=schema/subscribers.sql`. |
| `SITE_URL` | Canonical links | Build-time origin. Defaults to `https://gpufit.dev`. |

Copy `.env.example` to `.env` for local overrides. `.env` is gitignored.

D1 binding shape in `wrangler.jsonc` once the database exists:

```jsonc
"d1_databases": [
  { "binding": "DB", "database_name": "gpufit", "database_id": "<from wrangler d1 create>" }
]
```

## What is real, and what is stubbed

Real in this repo:

- Curated hardware list (NVIDIA, AMD, Intel, Apple M1–M5, a Ryzen AI Max part, and CPU bandwidth classes) with a source note on each row.
- About 190 open models with GGUF sizes and `config.json` fields fetched from the public Hugging Face API.
- Unit-tested fit math: weights, GQA / sliding-window / MLA / linear-attention KV cache, llama.cpp overhead, the 75% unified-memory default, partial offload, and a tok/s range.
- Static pages: home with a saved picker, per-model, per-device, “Can I run X on Y” for popular pairs, VRAM guides, “New this week”, RSS, and Atom.
- Run commands for llama.cpp, plus Ollama when the library name matched, and an LM Studio `lms get` hint.

Stubbed or local-only:

- Alert email. The Resend + D1 code path is implemented and unused until the env vars and binding exist. Bindings are read from `cloudflare:workers` `env` (`DB`), not `Astro.locals.runtime`. `astro dev` runs the route inside workerd, which does not keep a file store between requests, so the form saves the signup in `localStorage` and shows a signed confirmation link. A Node process (the dry-run matcher) still reads `data/subscribers.json`. A deployment without those secrets does not store the address on the server.
- No double-opt-in email is actually delivered here, because no Resend account was created.
- Speed calibration. A “my measured tok/s” box stores the number in `localStorage` only.
- No accounts, no multi-GPU, no KV-cache quantization, no prefill / time-to-first-token, no affiliate or “rent a GPU” box.
- Ollama tags are the library name (`ollama run qwen3`), not a pinned quant tag. The library page is HTML and the parser fails soft.
- Browser GPU detection only pre-selects a row. It cannot see VRAM.

## Project map

- `src/lib/estimator/` — fit and speed math
- `src/data/quant-meta.json` — shared bits-per-weight and quality ranks
- `src/data/hardware.json`, `src/data/models.json` — catalogs the site builds from
- `scripts/fetch_models.py` — Hugging Face pull
- `scripts/hardware_catalog.py` — device table
- `scripts/match-alerts.ts` — dry-run alert matcher
- `schema/subscribers.sql` — D1 schema
