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

from services import ela as ela_service
from services import metadata as metadata_service
from services import prelint

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
    version="0.3.0",
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
            detail = redact(f"Client initialization failed: {exc}")
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


def redact(text: str) -> str:
    """Strip anything key-shaped from text before it reaches a client or a log.

    Upstream SDK errors are relayed to unauthenticated callers, so never trust
    that a third-party exception message is free of credentials.
    """
    out = str(text)
    if API_KEY:
        out = out.replace(API_KEY, "***REDACTED***")
    # Catch key-shaped strings generally: Google API keys, Vertex express keys,
    # and any `key=`/`api_key=` query parameter that slips into an error URL.
    out = re.sub(r"AIza[0-9A-Za-z_\-]{10,}", "***REDACTED***", out)
    out = re.sub(r"AQ\.[0-9A-Za-z_\-]{10,}", "***REDACTED***", out)
    out = re.sub(r"((?:api_)?key=)[^&\s\"']{8,}", r"\1***REDACTED***", out, flags=re.IGNORECASE)
    return out


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


MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", 15 * 1024 * 1024))


async def _read_image(file: UploadFile) -> tuple[Image.Image, bytes]:
    """Validate and decode an upload into (PIL image, original bytes).

    The original bytes are kept because metadata forensics needs the intact
    container — Pillow discards JUMBF/C2PA boxes on decode.
    """
    if file.content_type and not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {file.content_type}")

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Image is {len(raw) // 1024} KB; limit is {MAX_UPLOAD_BYTES // 1024} KB.",
        )
    try:
        image = Image.open(io.BytesIO(raw))
        image.load()
    except Exception:
        raise HTTPException(status_code=400, detail="Could not decode the uploaded file as an image.")
    return image, raw


@app.post("/api/v1/analyze/ela")
async def analyze_ela(
    file: UploadFile = File(...),
    quality: int = Form(90),
):
    """Error Level Analysis. Returns a base64 PNG heatmap plus metrics.

    Runs entirely locally — no model call, no API key required.
    """
    image, _ = await _read_image(file)
    if not 50 <= quality <= 100:
        raise HTTPException(status_code=400, detail="quality must be between 50 and 100.")
    try:
        result = ela_service.compute_ela(image, quality=quality)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=redact(f"ELA failed: {exc}"))
    return {"filename": file.filename, "ela": result}


@app.post("/api/v1/analyze/metadata")
async def analyze_metadata(file: UploadFile = File(...)):
    """C2PA / EXIF / XMP provenance parse. Local only, no model call."""
    image, raw = await _read_image(file)
    try:
        return {"filename": file.filename, "metadata": metadata_service.parse_metadata(image, raw)}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=redact(f"Metadata parse failed: {exc}"))


@app.post("/api/v1/forensics/analyze")
async def analyze_image(
    file: UploadFile = File(...),
    prompt: str | None = Form(None),
    include_ela: bool = Form(True),
):
    """Full forensic pass: metadata -> model analysis -> prelint reconciliation.

    Local evidence (metadata, ELA) is gathered first so the prelint stage can
    reconcile the model's visual read against it rather than trusting it blindly.
    """
    if not API_KEY:
        raise HTTPException(
            status_code=503,
            detail="No API key configured. Set GOOGLE_API_KEY or PAID_GEMINI_API_KEY in backend/.env.",
        )

    image, raw = await _read_image(file)

    # Local evidence first — these never fail the request on their own.
    try:
        meta = metadata_service.parse_metadata(image, raw)
    except Exception as exc:
        meta = {"verdict": "error", "rationale": redact(str(exc)), "ai_signatures": [], "editing_software": []}

    ela_result = None
    if include_ela:
        try:
            ela_result = ela_service.compute_ela(image)
        except Exception:
            ela_result = None  # ELA is supporting evidence; never block on it

    # Inbound prelint: the caller's text is concatenated into the system prompt.
    safe_prompt, prompt_findings = prelint.lint_prompt(prompt)

    user_prompt = FORENSICS_SYSTEM_PROMPT
    if safe_prompt:
        user_prompt += f"\nAdditional analyst instructions: {safe_prompt}"

    try:
        raw_report, model_used = _generate_report(image, user_prompt)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=redact(f"Gemini analysis failed: {exc}"))

    # Outbound prelint: normalise, check consistency, reconcile with evidence.
    report, output_findings = prelint.lint_report(raw_report, metadata=meta, ela=ela_result)
    findings = prompt_findings + output_findings

    return {
        "filename": file.filename,
        "content_type": file.content_type,
        "size_bytes": len(raw),
        "dimensions": {"width": image.width, "height": image.height},
        "model": model_used,
        "key_mode": KEY_MODE,
        "report": report,
        "metadata": meta,
        "ela": ela_result,
        "prelint": {**prelint.summarise(findings), "findings": findings},
    }
