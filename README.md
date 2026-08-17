# PixelGuard-AI

Enterprise Generative Media Provenance &amp; Forensics Suite. Detects tampering and tracks AI asset origin using robust, imperceptible frequency-domain watermarking and signed C2PA manifests.

Tags: python, fastapi, pytorch, opencv, gemini-api, c2pa, provenance, ai-security, media-forensics, generative-ai

## Architecture

Monorepo with two independently deployable apps:

```
PixelGuard-AI/
├── frontend/   React + Vite + Tailwind CSS  →  Netlify / Vercel
└── backend/    Python + FastAPI + Uvicorn   →  Render / Hugging Face Spaces (Docker)
```

The backend wraps **Gemini 1.5 Pro** as the forensic analysis engine: upload an image, receive a structured JSON report with an integrity score, tampering indicators, and a suspected AI model signature.

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

Open http://localhost:5173, drop an image, and hit **Run Forensics**.

## API Endpoints

| Method | Path | Description |
| --- | --- | --- |
| GET | `/` | Liveness check |
| GET | `/api/v1/health` | API key + model configuration status |
| POST | `/api/v1/forensics/analyze` | Multipart upload (`file`, optional `prompt`) → JSON forensic report |

Example:

```bash
curl -X POST http://localhost:8000/api/v1/forensics/analyze \
  -F "file=@sample.jpg" \
  -F "prompt=focus on lighting consistency"
```

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

### Step 3 — Close the CORS loop

1. Back in Render, set `CORS_ORIGINS` to your Vercel domain(s), comma-separated:
   `https://pixelguard.vercel.app` (add preview domains if you want them to reach the API).
2. Render redeploys automatically on the env change. Open your Vercel URL, upload an image, and **Run Forensics** — the full pipeline should work end to end.

## Environment Variables

| Variable | Where | Purpose |
| --- | --- | --- |
| `GOOGLE_API_KEY` | backend | Gemini developer API key, `AIza…` (see `backend/.env.example`) |
| `PAID_GEMINI_API_KEY` | backend | Alternative name for the key, e.g. paid `AQ.…` keys |
| `GEMINI_MODEL` | backend | Optional model override (default `gemini-pro-latest`, auto-fallback) |
| `GEMINI_KEY_MODE` | backend | `developer` (default) or `vertex` for Vertex AI express keys |
| `CORS_ORIGINS` | backend | Comma-separated production frontend origins (localhost is always allowed) |
| `VITE_API_BASE_URL` | frontend | Backend base URL (defaults to `http://localhost:8000`) |
