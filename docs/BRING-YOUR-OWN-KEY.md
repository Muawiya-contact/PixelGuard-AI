# Bring your own Gemini key

The hosted demo at **https://pixel-guard-ai-nine.vercel.app/** runs **without a Gemini
API key**. That is deliberate, not an outage:

- `POST /api/v1/forensics/analyze` is unauthenticated. Any key configured on the
  public backend is a bill that anyone who finds the URL can run up.
- With no key, the backend never calls Gemini, so the deployment costs **zero**.
- Everything that runs without the model still works on the demo — SHA-256 /
  perceptual hashes, EXIF / XMP / C2PA metadata parsing, and the ELA heatmap.
  Only the model verdict is missing, and the UI says so instead of failing.

The model-backed endpoints answer `503` with a plain explanation, and
`GET /api/v1/health` reports `"status": "offline"` with `"ai_enabled": false`.

## Run the full pipeline locally (5 minutes)

### 1. Get a key

Free developer key: <https://aistudio.google.com/apikey> (starts with `AIza…`).
A paid / service-restricted GCP key (`AQ.…`) works too — same variable, same
endpoint.

### 2. Put it in `backend/.env`

```bash
cd backend
cp .env.example .env
```

Then edit `.env`:

```dotenv
GOOGLE_API_KEY=AIza...your_key_here
```

`PAID_GEMINI_API_KEY` is accepted as an alternative name. `.env` is gitignored
and excluded from the Docker image by `.dockerignore`, so the key never leaves
your machine.

### 3. Start the backend

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Confirm the key was picked up:

```bash
curl -s http://localhost:8000/api/v1/health
```

Expect `"status": "ok"` and `"ai_enabled": true`. If you still see
`"ai_enabled": false`, the process did not see the variable — check that `.env`
sits in `backend/` and that you restarted uvicorn.

### 4. Start the frontend

```bash
cd ../frontend
npm install
npm run dev
```

Open <http://localhost:5173>. With a key present, the amber "AI analysis is not
enabled" banner disappears and **Run Offline Forensics** becomes **Run
Forensics**.

## Deploying your own instance with a key

Nothing stops you from running a keyed deployment — it is your quota. Set
`GOOGLE_API_KEY` (or `PAID_GEMINI_API_KEY`) in your host's environment settings,
never in git. Before you leave it public, read the *Known exposure* section of
the [README](../README.md#known-exposure-the-analyze-endpoint-is-public): add a
spending cap on the Google Cloud project at minimum.

## Turning the model off even when a key exists

```dotenv
PIXELGUARD_DISABLE_AI=1
```

The backend then behaves exactly like the keyless demo — no model calls, `503`
from the analyze endpoints — without you having to delete the variable. Useful
for a public demo build, or for pinning spend to zero while you leave the key
configured for local work.

## Removing the key from a live deployment

The key belongs to the **backend** only. The frontend never sees it, so there is
nothing to remove on Vercel unless you added it there by mistake.

### Render (backend — this is where a key would be)

1. <https://dashboard.render.com> → your `pixelguard-backend` service.
2. **Environment** in the left sidebar.
3. Delete `PAID_GEMINI_API_KEY` and `GOOGLE_API_KEY` if either is present
   (**⋯ → Delete**), then **Save changes**. Render redeploys automatically.
4. Verify: `curl -s https://<your-backend>.onrender.com/api/v1/health` →
   `"ai_enabled": false`, `"api_key_present": false`.

### Vercel (frontend — should hold no key at all)

1. <https://vercel.com> → your project → **Settings → Environment Variables**.
2. The only variable that belongs here is `VITE_API_BASE_URL`. Delete anything
   Gemini-shaped (`GOOGLE_API_KEY`, `PAID_GEMINI_API_KEY`, `VITE_GEMINI_*`).
3. **Redeploy** from the Deployments tab — Vite bakes env values into the bundle
   at build time, so removing a variable only takes effect on the next build.
4. If a `VITE_`-prefixed key was ever deployed, treat it as public: it was
   shipped inside the JavaScript bundle. **Revoke it** at
   <https://aistudio.google.com/apikey> and issue a new one.

### After removing the key

Revocation, not deletion, is what stops the billing. If the key was ever set on
a public backend, revoke and reissue it — anyone who scraped the URL cannot spend
a key that no longer exists.
