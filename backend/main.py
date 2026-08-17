"""PixelGuard: AI Asset Provenance & Forensics Engine — Backend API."""

import io
import json
import os
import re

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from google.genai import types as genai_types
from PIL import Image

load_dotenv()

# Key via GOOGLE_API_KEY or PAID_GEMINI_API_KEY. Both developer-API keys (AIza…)
# and service-restricted GCP keys (AQ.…) use the developer endpoint by default;
# set GEMINI_KEY_MODE=vertex only for true Vertex AI express-mode keys.
API_KEY = os.getenv("GOOGLE_API_KEY") or os.getenv("PAID_GEMINI_API_KEY")
KEY_MODE = os.getenv("GEMINI_KEY_MODE", "developer").strip().lower()

# "-latest" aliases track Google's current models and never go stale.
PREFERRED_MODEL = os.getenv("GEMINI_MODEL", "gemini-pro-latest")
FALLBACK_MODELS = ["gemini-flash-latest", "gemini-3.1-pro-preview", "gemini-3.7-flash"]

_client: genai.Client | None = None


def get_client() -> genai.Client:
    global _client
    if _client is None:
        if not API_KEY:
            raise RuntimeError("No API key configured")
        if KEY_MODE == "vertex":
            _client = genai.Client(vertexai=True, api_key=API_KEY)
        else:
            _client = genai.Client(api_key=API_KEY)
    return _client


app = FastAPI(
    title="PixelGuard API",
    description="AI Asset Provenance & Forensics Engine",
    version="0.2.0",
)

# CORS. Local dev origins are always allowed. Production origins come from
# CORS_ORIGINS (comma-separated); CORS_ORIGINS=* allows everything.
# Vercel deployments — production plus every preview/branch URL — are matched by
# CORS_ORIGIN_REGEX so a new preview deploy never needs a backend env change.
_default_origins = ["http://localhost:5173", "http://127.0.0.1:5173"]
_extra_origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()]
ALLOW_ALL_ORIGINS = "*" in _extra_origins
CORS_ORIGINS = ["*"] if ALLOW_ALL_ORIGINS else _default_origins + _extra_origins

# Matched with re.fullmatch, so it cannot be spoofed by a suffix/query trick.
CORS_ORIGIN_REGEX = None if ALLOW_ALL_ORIGINS else os.getenv(
    "CORS_ORIGIN_REGEX", r"https://[a-z0-9-]+\.vercel\.app"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_origin_regex=CORS_ORIGIN_REGEX,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

FORENSICS_SYSTEM_PROMPT = """\
You are PixelGuard, an expert digital-image forensics engine. Analyze the provided
image for authenticity, tampering, and AI-generation signatures.

Respond ONLY with a valid JSON object (no markdown fences, no commentary) using
exactly this schema:
{
  "verdict": "authentic" | "ai_generated" | "manipulated" | "inconclusive",
  "integrity_score": <integer 0-100, where 100 = fully authentic>,
  "confidence": <integer 0-100>,
  "tampering_detection": {
    "detected": <boolean>,
    "indicators": [<list of specific artifacts observed, e.g. cloning, splicing, inpainting, warped anatomy, inconsistent lighting/shadows, JPEG ghosting>]
  },
  "model_signature": {
    "likely_ai_generated": <boolean>,
    "suspected_model_family": <string or null, e.g. "Midjourney", "DALL-E", "Stable Diffusion", "GAN", null>,
    "signature_evidence": [<list of stylistic/statistical cues>]
  },
  "provenance_notes": <string: brief summary of visible metadata-independent provenance cues>,
  "summary": <string: 2-3 sentence human-readable forensic conclusion>
}
"""


@app.get("/")
def root():
    return {"message": "PixelGuard Backend API Active"}


@app.get("/api/v1/health")
def health():
    api_key_present = bool(API_KEY)
    client_ok = False
    detail = "No API key found — set GOOGLE_API_KEY or PAID_GEMINI_API_KEY in backend/.env"
    if api_key_present:
        try:
            get_client()
            client_ok = True
            detail = f"Client ready in {KEY_MODE} mode"
        except Exception as exc:  # pragma: no cover
            detail = f"Client initialization failed: {exc}"
    return {
        "status": "ok" if (api_key_present and client_ok) else "degraded",
        "api_key_present": api_key_present,
        "key_mode": KEY_MODE if api_key_present else None,
        "model": PREFERRED_MODEL,
        "fallback_models": FALLBACK_MODELS,
        "model_configured": client_ok,
        "cors": {"allow_origins": CORS_ORIGINS, "allow_origin_regex": CORS_ORIGIN_REGEX},
        "detail": detail,
    }


def _extract_json(text: str) -> dict:
    """Parse the model response into JSON, tolerating markdown fences."""
    cleaned = (text or "").strip()
    fence = re.search(r"```(?:json)?\s*(.*?)\s*```", cleaned, re.DOTALL)
    if fence:
        cleaned = fence.group(1)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        # Fall back to the first {...} block in the text.
        brace = re.search(r"\{.*\}", cleaned, re.DOTALL)
        if brace:
            try:
                return json.loads(brace.group(0))
            except json.JSONDecodeError:
                pass
    return {"verdict": "inconclusive", "raw_response": text}


def _is_model_unavailable(exc: Exception) -> bool:
    msg = str(exc).lower()
    return any(
        s in msg
        for s in (
            "not_found",
            "not found",
            "404",
            "does not exist",
            "unsupported model",
            "no longer available",  # retired-for-new-users models
        )
    )


def _generate_report(image: Image.Image, user_prompt: str) -> tuple[dict, str]:
    """Try the preferred model, falling back through newer models if unavailable."""
    client = get_client()
    config = genai_types.GenerateContentConfig(response_mime_type="application/json")
    last_exc: Exception | None = None
    for model_name in [PREFERRED_MODEL] + [m for m in FALLBACK_MODELS if m != PREFERRED_MODEL]:
        try:
            response = client.models.generate_content(
                model=model_name,
                contents=[user_prompt, image],
                config=config,
            )
            return _extract_json(response.text), model_name
        except Exception as exc:
            last_exc = exc
            if _is_model_unavailable(exc):
                continue
            raise
    raise last_exc if last_exc else RuntimeError("No model available")


@app.post("/api/v1/forensics/analyze")
async def analyze_image(
    file: UploadFile = File(...),
    prompt: str | None = Form(None),
):
    if not API_KEY:
        raise HTTPException(
            status_code=503,
            detail="No API key configured. Set GOOGLE_API_KEY or PAID_GEMINI_API_KEY in backend/.env.",
        )

    if file.content_type and not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {file.content_type}")

    raw = await file.read()
    try:
        image = Image.open(io.BytesIO(raw))
        image.load()
    except Exception:
        raise HTTPException(status_code=400, detail="Could not decode the uploaded file as an image.")

    user_prompt = FORENSICS_SYSTEM_PROMPT
    if prompt:
        user_prompt += f"\nAdditional analyst instructions: {prompt}"

    try:
        report, model_used = _generate_report(image, user_prompt)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Gemini analysis failed: {exc}")

    return {
        "filename": file.filename,
        "content_type": file.content_type,
        "size_bytes": len(raw),
        "dimensions": {"width": image.width, "height": image.height},
        "model": model_used,
        "key_mode": KEY_MODE,
        "report": report,
    }
