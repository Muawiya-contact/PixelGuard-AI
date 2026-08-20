# PixelGuard-AI

[![CI](https://github.com/Muawiya-contact/PixelGuard-AI/actions/workflows/ci.yml/badge.svg)](https://github.com/Muawiya-contact/PixelGuard-AI/actions/workflows/ci.yml)
[![Deploy](https://github.com/Muawiya-contact/PixelGuard-AI/actions/workflows/deploy.yml/badge.svg)](https://github.com/Muawiya-contact/PixelGuard-AI/actions/workflows/deploy.yml)

Enterprise Generative Media Provenance &amp; Forensics Suite. Detects tampering and tracks AI asset origin using robust, imperceptible frequency-domain watermarking and signed C2PA manifests.

Tags: python, fastapi, pytorch, opencv, gemini-api, c2pa, provenance, ai-security, media-forensics, generative-ai

## Demo

| | |
| --- | --- |
| **Live app** | **https://pixel-guard-ai-nine.vercel.app/** |
| **Backend health** | https://pixelguard-ai.onrender.com/api/v1/health |
| **API docs** | https://pixelguard-ai.onrender.com/docs |

[▶ Watch the 3-minute demo](docs/pixelguard-demo.mp4) — 1280×720, 3:03, recorded against the deployed app. Silent, with on-screen captions.

A [sample forensic certificate](docs/sample-forensic-certificate.pdf) exported during that recording is included too.

The demo runs two real investigations. First, a photorealistic Gemini-generated image: the vision model flags structural artefacts (garbled pseudotext, incoherent hardware) at 83% confidence while the metadata parser independently finds Google's SynthID provenance marker — two evidence paths reaching the same verdict, **AI Generated**. Then a real photograph with its metadata stripped in transit: **Authentic Photograph**. A tool that only ever says "fake" is useless — clearing real images matters as much as catching synthetic ones. When evidence paths disagree, prelint reports the conflict as a named finding instead of silently picking a side.

> The backend runs on Render's free tier, which sleeps after ~15 minutes idle. **The first request can take ~23 seconds**; every request after that is ~8 seconds. Hit the health endpoint once to wake it before demoing.

## Architecture

Monorepo with two independently deployable apps:

```
PixelGuard-AI/
├── frontend/   React + Vite + Tailwind CSS  →  Netlify / Vercel
└── backend/    Python + FastAPI + Uvicorn   →  Render / Hugging Face Spaces (Docker)
```

The backend wraps **Gemini** (`gemini-flash-latest` by default) as the visual analysis engine: upload an image, receive a structured JSON report with a media-type classification, an integrity score, tampering indicators, and a suspected generator signature — reconciled against metadata and ELA evidence before it is returned.

## Quick Start (Local)

### 1. Backend (port 8000)

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # then paste your Gemini API key into .env
uvicorn main:app --reload --port 8000
```

Get a free Gemini API key at https://aistudio.google.com/apikey.

Verify: http://localhost:8000 → `{"message": "PixelGuard Backend API Active"}`
Health: http://localhost:8000/api/v1/health
Docs: http://localhost:8000/docs

### 2. Frontend (port 5173)

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173, drop an image (or pick one from the **Sample gallery**), and hit **Run Forensics**.

The frontend adds a draggable **original vs. ELA heatmap** comparison slider, a **Download Forensic Certificate** button that produces a PDF report of the findings and their limitations, and a **sample gallery** of procedurally generated fixtures — each carrying a crafted metadata or compression history so a specific detector can be seen firing against known ground truth. Those fixtures are synthetic, not photographs, and the UI says so.

**Import from URL** lets you analyse an image without downloading it first. The fetch happens server-side (the browser cannot read cross-origin images), which makes it an SSRF surface — so `backend/services/fetch_url.py` resolves every hop and refuses any non-public address, allows only http/https, re-validates redirects by hand, and caps the response while streaming. **Copy JSON** puts the analysis payload on the clipboard with the base64 heatmap stripped.

**Light and dark themes** follow the OS preference until you pick a side with the header toggle, after which the choice persists. Both are driven by semantic CSS variables (`--pg-bg`, `--pg-fg`, …) declared in `src/index.css`, so adding a theme means redefining tokens rather than editing components. An inline script in `index.html` applies the stored theme before first paint, avoiding a flash of the wrong background. Text contrast was measured in-browser against both palettes and meets WCAG AA (≥4.5:1) for body, secondary, and faint text.

## API Endpoints

| Method | Path | Description |
| --- | --- | --- |
| GET | `/` | Liveness check |
| GET | `/api/v1/health` | API key, model and CORS configuration status |
| POST | `/api/v1/forensics/analyze` | Full pass: metadata + ELA + model analysis + verification |
| POST | `/api/v1/analyze/ela` | Error Level Analysis heatmap (local, no API key needed) |
| POST | `/api/v1/analyze/metadata` | C2PA / EXIF / XMP parse (local, no API key needed) |
| POST | `/api/v1/analyze/fingerprint` | SHA-256, geometry and colour statistics (local) |
| POST | `/api/v1/analyze/local` | All three local detectors at once, no model call (~0.4s) |
| POST | `/api/v1/analyze/url` | Fetch a public image URL and run the full pipeline (JSON body) |
| POST | `/api/v1/fetch-url` | Fetch a public image URL and return it as a data URI |

```bash
curl -X POST http://localhost:8000/api/v1/forensics/analyze \
  -F "file=@sample.jpg" \
  -F "prompt=focus on lighting consistency"
```

## Forensic pipeline

A request to `/api/v1/forensics/analyze` runs these stages, in this order:

1. **Metadata** (`backend/services/metadata.py`) — parses EXIF, PNG text chunks, XMP, and scans the raw container for C2PA markers and generator signatures (Stable Diffusion, ComfyUI, Midjourney, DALL·E, Firefly, Imagen/SynthID, FLUX, and others). Signatures found in parsed metadata are reported with higher confidence than ones found only in the raw container.

2. **Error Level Analysis** (`backend/services/ela.py`) — re-encodes the image at a known JPEG quality and maps the per-pixel difference to a colour heatmap, returned as a base64 PNG. Implemented with Pillow + NumPy rather than OpenCV, which would add tens of megabytes to a container that cold-starts on a free tier.

3. **Fingerprint** (`backend/services/fingerprint.py`) — SHA-256 and MD5 of the exact analysed bytes, plus dimensions, aspect-ratio breakdown, and dominant colours by area. Not a detector: it is the descriptive record that lets someone else confirm a certificate refers to the image in front of them.

4. **Prelint** (`backend/services/prelint.py`) — verification on both sides of the model call. Inbound, the caller's free-text instructions are scanned for prompt-injection phrasing and neutralised before they reach Gemini. Outbound, the model's JSON is coerced to the expected schema, range-clamped, checked for self-contradiction, and reconciled against the metadata evidence. Every correction is reported in `prelint.findings` rather than applied silently.

### Latency

Measured on a 9.34 MP photo (2288×4080), best of two runs:

| Change | Before | After |
| --- | --- | --- |
| Model: `gemini-pro-latest` → `gemini-flash-latest` | 13.2s | 5.0s |
| Sending full-resolution vs. capped at 1024px | 10.1s | 5.0s |
| Full request, sequential → concurrent | ~19.3s | ~4.6s |
| Local evidence only (`/analyze/local`) | — | ~0.4–0.9s |

Three things get you there:

- **Concurrency.** Metadata, fingerprint, ELA and the Gemini call all run at once via `asyncio.gather`, so the request costs about what the model call alone costs instead of the sum.
- **Downscaling.** Only a copy capped at `GEMINI_MAX_EDGE` (1024px) goes to the model. Forensic detail that survives a 1024px downscale is what a vision model can use anyway; the full-resolution original is what ELA and hashing see.
- **Optimistic UI.** The frontend fires `/analyze/local` alongside the full pass. Hashes, metadata and the ELA heatmap paint in ~360ms while only the verdict box waits on the model.

Set `GEMINI_MODEL=gemini-pro-latest` to trade latency back for the larger model. Note that `gemini-2.5-flash` is retired for new API keys and returns 404 — use the `-latest` aliases.

### Three-tier classification

Every report carries a `media_type` alongside the verdict, because "authentic" means something different for a photograph than for a drawing — calling a hand-made illustration merely *authentic* invites a reader to conclude it depicts something real.

| `media_type` | `verdict_key` | `verdict` (display) |
| --- | --- | --- |
| `photograph` | `authentic_photograph` | Authentic Photograph |
| `digital_art_illustration` | `authentic_digital_art` | Authentic Digital Art |
| `ai_synthetic` | `ai_generated` | AI Generated |
| — | `manipulated` | Manipulated |
| `unknown` | `inconclusive` | Inconclusive / Human Review Needed |

Reports include **both** `verdict_key` (stable snake_case) and `verdict` (the display string). All logic — prelint rules, UI styling, PDF colours — branches on the key; branching on prose means a copy-edit silently changes behaviour. The vocabulary lives in `backend/schemas/report.py`.

### False-positive guardrails

Telling someone their own photograph is synthetic is the expensive mistake, so the pipeline is deliberately biased toward authenticity.

The **prompt** (`backend/services/gemini.py`) classifies media type first, makes authenticity the null hypothesis, and names what a vision model over-reads — bokeh, JPEG mush, skin smoothing, motion blur, *and clean vector lines and flat cel shading*, which are what digital art **is** — as explicitly not evidence. `AI Generated` requires structural impossibility (extra fingers, pseudotext, broken occlusion) or a provenance manifest, at >80% confidence.

Three deterministic rules then run in `backend/services/prelint.py`, each emitting a finding so a reviewer can see exactly what moved a verdict:

| Rule | Condition | Effect |
| --- | --- | --- |
| **1 — Digital art sanitisation** | Verdict is authentic-photograph-shaped but media type (or style wording) says artwork | → `Authentic Digital Art` |
| **2 — Low-confidence fallback** | `AI Generated` below 80% confidence, no C2PA manifest, `no_metadata` | → `Inconclusive / Human Review Needed`, integrity 50 |
| **3 — EXIF priority guard** | Physical capture EXIF present (ISO, exposure, focal length, model) | → `Authentic Photograph`, unless C2PA declares synthetic generation |

A generator signature in metadata outranks all three. When any rule moves a verdict the summary is annotated, so a certificate never reads "AI Generated" above "no generative AI indicators present".

Set `PIXELGUARD_GUARDRAILS=off` to disable rules 1–3, or `PIXELGUARD_AI_CONFIDENCE_FLOOR` to move the rule-2 threshold.

**Measured.** Three real phone photographs (portrait, soft focus, smooth skin) → `Authentic Photograph`, empty indicator lists. A flat cel-shaded anime fixture → `Authentic Digital Art`, with the mandated summary opening. The Stable Diffusion fixture → `AI Generated` via its metadata signature.

**The residual gap:** strip the metadata from that AI fixture and it reads as authentic digital art. With metadata gone — the normal state of anything off a social platform — AI detection rests almost entirely on the metadata parser. Rules 1–3 do not close that; only a real generative-artefact detector would.

### What these detectors can and cannot tell you

Honest limits matter more than an impressive verdict:

- **Metadata is decisive when present and meaningless when absent.** A Stable Diffusion parameter block is close to proof of generation; no metadata at all is uninformative, because every major platform strips it on upload. It is also trivially forged.
- **C2PA manifests are detected, not validated.** Verifying the signature chain needs the `c2pa` library and a trust list. An unvalidated manifest is a claim, not proof.
- **ELA is a visualization, not a classifier.** Benchmarked here against composites with known ground truth, its tile statistics did **not** separate edited images from clean ones — untouched images with fine texture routinely score higher than spliced ones. It is shipped as a heatmap for a human to read, and deliberately makes no tampering claim. A skilled edit re-saved at the same quality leaves no ELA trace at all.
- **The visual verdict comes from a general-purpose language model** and can be confidently wrong. Prelint exists precisely because that output cannot be trusted unchecked.

## Deployment (Continuous Deployment from GitHub)

Deploy the backend first (you need its URL for the frontend), then the frontend, then close the CORS loop.

### Step 1 — Backend on Render (Docker, free tier)

1. Push this repo to GitHub and sign in at [dashboard.render.com](https://dashboard.render.com) with your GitHub account.
2. Click **New → Web Service** and select your `PixelGuard-AI` repository.
3. Configure the service:
   - **Language / Runtime:** Docker
   - **Root Directory:** `backend`
   - **Instance Type:** Free
4. Under **Environment Variables**, add:
   - `PAID_GEMINI_API_KEY` = your Gemini API key (paste it in the dashboard — it is a secret and never belongs in git). `GOOGLE_API_KEY` works too.
   - `CORS_ORIGINS` = leave empty for now; you'll set it in Step 3.
5. Click **Deploy Web Service**. When the build finishes, note your backend URL, e.g. `https://pixelguard-backend.onrender.com`.
6. Verify: open `https://<your-backend>.onrender.com/api/v1/health` — it should report `"status": "ok"`.

Every push to `main` now redeploys the backend automatically.

> `backend/render.yaml` documents this service as a Render Blueprint. If you prefer the Blueprint flow (**New → Blueprint**), first copy it to the repo root — Render only auto-detects `render.yaml` there (it already targets `backend/` via `rootDir`).

> Free-tier note: the service sleeps after ~15 min of inactivity; the first request after a sleep takes up to a minute.

### Step 2 — Frontend on Vercel

1. Sign in at [vercel.com](https://vercel.com) with GitHub and click **Add New → Project**, then import `PixelGuard-AI`.
2. Configure the project:
   - **Root Directory:** `frontend` (Vercel then auto-detects Vite; build `npm run build`, output `dist`)
3. Under **Environment Variables**, add:
   - `VITE_API_BASE_URL` = your Render backend URL from Step 1 (no trailing slash), e.g. `https://pixelguard-backend.onrender.com`
4. Click **Deploy**. Note your production domain, e.g. `https://pixelguard.vercel.app`.

`frontend/vercel.json` rewrites all routes to `index.html` (SPA routing). Every push to `main` redeploys; PRs get preview URLs.

### Step 3 — CORS

**Vercel needs no extra configuration.** The backend allows any `*.vercel.app` origin by default — production, branch, and per-deploy preview URLs alike — so new previews work without touching backend env vars.

Only adjust CORS if:

- **Your frontend is not on Vercel** (Netlify, custom domain): set `CORS_ORIGINS` on Render to your origin(s), comma-separated.
- **You want to narrow the default:** set `CORS_ORIGIN_REGEX`, e.g. `https://pixelguard-ai[a-z0-9-]*\.vercel\.app`.
- **You need a wide-open API for a demo or hackathon judging:** set `CORS_ORIGINS=*`. Note this lets anyone who knows the URL spend your Gemini quota, so revert it afterwards.

Render redeploys automatically on an env change. To confirm what's live, `GET /api/v1/health` reports the effective CORS config:

```bash
curl -s https://your-backend.onrender.com/api/v1/health
```

### Troubleshooting: "Could not reach the backend"

That message means the browser's request never completed — usually CORS, not downtime. Check in this order:

1. **Is the backend up?** `curl https://your-backend.onrender.com/api/v1/health` → expect `"status": "ok"`. On the free tier the first call after ~15 min idle can take up to a minute.
2. **Is the preflight passing?** Substitute your real frontend origin:
   ```bash
   curl -i -X OPTIONS https://your-backend.onrender.com/api/v1/forensics/analyze -H "Origin: https://your-app.vercel.app" -H "Access-Control-Request-Method: POST"
   ```
   A working response is `HTTP 200` **with** an `access-control-allow-origin` header. A `400` with no such header means the origin is rejected — fix it via the CORS options above.
3. **Is the frontend pointed at the right backend?** `VITE_API_BASE_URL` must be set in Vercel with no trailing slash. It is baked in at build time, so redeploy after changing it.

## Security: handling the Gemini API key

The key is a server-side secret. It is read from the environment at startup and **never** reaches the browser — the frontend only ever talks to your backend.

**Where the key belongs**

| Environment | Location | Notes |
| --- | --- | --- |
| Local | `backend/.env` | gitignored; only `.env.example` (placeholder) is committed |
| Render | Dashboard → Environment | declared `sync: false` in `render.yaml`, so no value lives in git |
| Vercel | *nowhere* | the frontend never sees the key |

**Never** give the key a `VITE_` prefix. Vite inlines every `VITE_*` variable into the JavaScript bundle it ships to browsers, which would publish the key to anyone who opens devtools.

**Built-in protections**

- `backend/.dockerignore` keeps `.env` out of container images.
- `/api/v1/health` reports only whether a key is present (a boolean), never its value.
- All upstream error text passes through `redact()` before reaching a client or a log, so a Gemini SDK exception cannot relay credentials even if a future version includes them in a message.
- CI fails the build if any endpoint echoes key-shaped data.

**If a key is ever exposed,** revoke it first at [aistudio.google.com/apikey](https://aistudio.google.com/apikey) (or the Google Cloud console) and then issue a new one. Rotation is the only real fix — scrubbing it from git history does not help once it has been pushed.

### Known exposure: the analyze endpoint is public

`POST /api/v1/forensics/analyze` requires no authentication, so anyone who discovers your Render URL can submit images and **spend your Gemini quota**. The key itself stays safe; the billing does not. This is a reasonable trade for a public demo, but before leaving it up long-term consider:

- setting a spending cap or quota limit on the Google Cloud project,
- restricting the API key to the Generative Language API in the Google Cloud console,
- requiring a shared token on the endpoint (note: any token the browser holds is itself public — real protection needs a login),
- or adding per-IP rate limiting.

Disabling the public API explorer also lowers discoverability: pass `docs_url=None, redoc_url=None` to `FastAPI(...)` in production.

## Environment Variables

| Variable | Where | Purpose |
| --- | --- | --- |
| `GOOGLE_API_KEY` | backend | Gemini developer API key, `AIza…` (see `backend/.env.example`) |
| `PAID_GEMINI_API_KEY` | backend | Alternative name for the key, e.g. paid `AQ.…` keys |
| `GEMINI_MODEL` | backend | Optional model override (default `gemini-pro-latest`, auto-fallback) |
| `GEMINI_KEY_MODE` | backend | `developer` (default) or `vertex` for Vertex AI express keys |
| `CORS_ORIGINS` | backend | Extra allowed origins, comma-separated; `*` allows all (localhost always allowed) |
| `CORS_ORIGIN_REGEX` | backend | Origin pattern, default `https://[a-z0-9-]+\.vercel\.app` (covers preview deploys) |
| `VITE_API_BASE_URL` | frontend | Backend base URL (defaults to `http://localhost:8000`) |
