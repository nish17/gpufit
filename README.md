# GPUfit

GPUfit tells you whether an open-source LLM fits on a GPU, a Mac, or a CPU, which quantization to use, how much context is practical, and a tokens-per-second range. The hardware profile stays in the browser. You can sign up to hear when a newly tracked model fits that machine.

The estimator is an estimate for llama.cpp, not a benchmark. The method is written up at `/how-it-works`.

## Local development

Clone the repo, then install and start it. Requires Node.js 22.22 or newer.

```bash
git clone https://github.com/nish17/gpufit.git
cd gpufit
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

The public site is `https://gpufit.tech`. `npm run build` uses that origin for canonical URLs, the sitemap, and `public/robots.txt` unless `SITE_URL` is set:

```bash
SITE_URL=https://gpufit.tech npm run build
```

`wrangler.jsonc` attaches `gpufit.tech` as a Worker custom domain on deploy. The domain has to be on the same Cloudflare account or that step fails.

### Scheduled catalog refresh

`.github/workflows/model-watcher.yml` runs `scripts/fetch_models.py` every six hours and pushes `src/data/models.json` when it changes. It then mails confirmed subscribers about newly tracked models that fit, and deploys the site when the catalog changed. Both of those steps do nothing until the GitHub Actions secrets below are set. Give the workflow a `HF_TOKEN` secret if you start hitting Hub rate limits. The default `GITHUB_TOKEN` needs permission to push to the default branch; branch protection that blocks bot pushes should be switched to a pull-request step instead.

Runs of that workflow are serialized. A new schedule waits for the previous run instead of canceling it, so a catalog push or a fit email is not cut off halfway.

Cloudflare cron is a poor fit for the fetch: it has to commit JSON back to the repo so the static pages rebuild. Keep the scheduler on GitHub Actions.

## Accounts and secrets

The site builds and the estimator runs with no accounts. Real alert email needs Resend, D1, and the secrets below on both the Worker and the GitHub Action.

| Secret or account | Required for | Notes |
| --- | --- | --- |
| Cloudflare account | Hosting and D1 | Workers + static assets. Free tier holds the first few thousand pages; the Workers Paid plan ($5/month) raises the file cap. |
| `gpufit.tech` | Public URL | Attach it to the Worker. `wrangler.jsonc` already has the custom domain route. |
| `HF_TOKEN` | Optional | Hugging Face read token. The fetcher works anonymously. GitHub Actions secret for the catalog job. |
| `RESEND_API_KEY` | Alert email | [Resend](https://resend.com). Worker secret for confirmations, and a GitHub Actions secret for new-model mail. Verify `gpufit.tech` (DKIM, SPF, and a DMARC record) before sending from it. |
| `ALERT_FROM` | Alert email | `GPUfit <alerts@gpufit.tech>`, after that domain is verified in Resend. Set it on the Worker and on the GitHub Action. |
| `ALERT_TOKEN_SECRET` | Alert links | Long random string. Signs confirm and unsubscribe links. The same value has to be on the Worker and the GitHub Action. Outside local dev the worker refuses to sign or accept tokens when this is missing or still `dev-only-change-me`. |
| `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` | Signup check | Optional Cloudflare Turnstile keys. The site key is public and is read at request time. The secret is a Worker secret. If the secret is unset, `POST /api/alerts` still accepts signups and logs a warning. |
| `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` | Fit mail and deploy | GitHub Actions only. The token needs D1 edit and Workers deploy. |
| Cloudflare D1 database | Alert storage | Binding `DB` is already in `wrangler.jsonc`. Fresh database: `npx wrangler d1 execute gpufit --remote --file=schema/subscribers.sql`. A database created earlier also needs `npx wrangler d1 execute gpufit --remote --file=schema/migrate-2026-10-24-confirm-sent.sql` once, so confirmation mail can cool down for 10 minutes per address. |
| `SITE_URL` | Canonical links and email links | Build-time origin, and the origin embedded in alert mail. Defaults to `https://gpufit.tech`. The request Host is not used for those links. |

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
- About 145 open models with GGUF sizes and `config.json` fields fetched from the public Hugging Face API. Fine-tunes and duplicate quants of the same checkpoint are left out. A quant file that is a partial shard, larger than the model’s BF16, or not a plausible size for its bit width is dropped before it can affect a verdict.
- Unit-tested fit math: weights, GQA / sliding-window / MLA / linear-attention KV cache, llama.cpp overhead, the 75% unified-memory default, partial offload, and a tok/s range.
- Static pages: home with a saved picker, per-model, per-device, “Can I run X on Y” for popular pairs, VRAM guides, new models, RSS, and Atom.
- Run commands for llama.cpp, plus Ollama when the library name matched, and an LM Studio `lms get` hint.

Stubbed or local-only:

- Alert email is implemented and waits on the secrets above. Confirmations go out from the Worker. New-model notes go out from `npm run alerts:match -- --send` (the GitHub Action runs that against D1). `npm run alerts:match` with no flag only prints who would be mailed, using `data/subscribers.json`. `astro dev` runs the signup route inside workerd, which does not keep a file store between requests, so the form saves the signup in `localStorage` and shows a signed confirmation link. The “also send a weekly digest” checkbox is stored and does not send a second email.
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
- `scripts/match-alerts.ts` — new-model alert mailer (dry run unless `--send`)
- `schema/subscribers.sql` — D1 schema, including `alert_sends` and `confirm_sent_at`
- `schema/migrate-2026-10-24-confirm-sent.sql` — one-time column add for an existing D1 database
- `public/_headers` and `src/middleware.ts` — browser security headers
- `SECURITY.md` — where to report a vulnerability
