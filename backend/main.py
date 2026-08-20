"""PixelGuard: AI Asset Provenance & Forensics Engine — Backend API."""

import asyncio
import base64
import io
import json
import os
import re

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from google import genai
from google.genai import types as genai_types
from PIL import Image
from urllib.parse import urlparse

from services import ela as ela_service
from services import fetch_url as fetch_url_service
from services.gemini import FORENSICS_SYSTEM_PROMPT
from services import fingerprint as fingerprint_service
from services import metadata as metadata_service
from services import prelint

load_dotenv()

# Key via GOOGLE_API_KEY or PAID_GEMINI_API_KEY. Both developer-API keys (AIza…)
# and service-restricted GCP keys (AQ.…) use the developer endpoint by default;
# set GEMINI_KEY_MODE=vertex only for true Vertex AI express-mode keys.
API_KEY = os.getenv("GOOGLE_API_KEY") or os.getenv("PAID_GEMINI_API_KEY")
KEY_MODE = os.getenv("GEMINI_KEY_MODE", "developer").strip().lower()

# "-latest" aliases track Google's current models and never go stale.
# Flash is the default: measured against the real forensic prompt it returns in
# ~5.0s versus ~13.2s for pro on the same downscaled input, and the reports are
# comparable in quality. Set GEMINI_MODEL=gemini-pro-latest to trade latency for
# the larger model.
PREFERRED_MODEL = os.getenv("GEMINI_MODEL", "gemini-flash-latest")
FALLBACK_MODELS = ["gemini-pro-latest", "gemini-3.7-flash", "gemini-3.1-pro-preview"]

# Longest edge sent to Gemini. A 9.34 MP phone photo takes ~10.1s to analyse;
# the same image capped at 1024px takes ~5.0s, and the verdicts do not differ
# in a way that survives the model's own run-to-run variance.
GEMINI_MAX_EDGE = int(os.getenv("GEMINI_MAX_EDGE", 1024))


def downscale_for_model(image: Image.Image) -> Image.Image:
    """Cap the longest edge before upload. Returns the original if already small."""
    if max(image.size) <= GEMINI_MAX_EDGE:
        return image
    copy = image.copy()
    copy.thumbnail((GEMINI_MAX_EDGE, GEMINI_MAX_EDGE), Image.LANCZOS)
    return copy

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
    version="0.5.0",
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
    image = downscale_for_model(image)
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


@app.post("/api/v1/analyze/fingerprint")
async def analyze_fingerprint(file: UploadFile = File(...)):
    """SHA-256, geometry and colour statistics. Local only, no model call."""
    image, raw = await _read_image(file)
    try:
        return {"filename": file.filename, "fingerprint": fingerprint_service.fingerprint(image, raw)}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=redact(f"Fingerprint failed: {exc}"))


async def _local_evidence(image: Image.Image, raw: bytes, include_ela: bool) -> dict:
    """Run the three local detectors concurrently.

    Each is CPU-bound and releases the GIL inside Pillow/NumPy, so threads give
    real overlap here. None of them may fail the request: they are supporting
    evidence, and a forensic report without a colour histogram is still useful.
    """

    async def safe(fn, *args, default=None, label=""):
        try:
            return await asyncio.to_thread(fn, *args)
        except Exception as exc:
            if label == "metadata":
                return {
                    "verdict": "error",
                    "rationale": redact(str(exc)),
                    "ai_signatures": [],
                    "editing_software": [],
                }
            return default

    tasks = [
        safe(metadata_service.parse_metadata, image, raw, label="metadata"),
        safe(fingerprint_service.fingerprint, image, raw),
    ]
    if include_ela:
        tasks.append(safe(ela_service.compute_ela, image))

    results = await asyncio.gather(*tasks)
    return {
        "metadata": results[0],
        "fingerprint": results[1],
        "ela": results[2] if include_ela else None,
    }


@app.post("/api/v1/fetch-url")
async def fetch_remote_image(url: str = Form(...)):
    """Fetch a public image URL server-side and return it as a data URI.

    The frontend cannot fetch arbitrary third-party images itself (CORS), so the
    server does it. See services/fetch_url.py for the SSRF guards: only public
    addresses, redirects re-validated per hop, and a streaming size cap.
    """
    try:
        raw, content_type, final_url = await asyncio.to_thread(fetch_url_service.fetch_image, url)
    except fetch_url_service.FetchError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=redact(f"Fetch failed: {exc}"))

    try:
        image = Image.open(io.BytesIO(raw))
        image.load()
    except Exception:
        raise HTTPException(status_code=400, detail="The URL did not return a decodable image.")

    name = (urlparse(final_url).path.rsplit("/", 1)[-1] or "remote-image")[:120]
    if "." not in name:
        name = f"{name}.{(image.format or 'png').lower()}"
    return {
        "filename": name,
        "content_type": content_type,
        "size_bytes": len(raw),
        "dimensions": {"width": image.width, "height": image.height},
        "data_uri": f"data:{content_type};base64," + base64.b64encode(raw).decode("ascii"),
        "source_url": final_url,
    }


@app.post("/api/v1/analyze/local")
async def analyze_local(
    file: UploadFile = File(...),
    include_ela: bool = Form(True),
):
    """Everything computable without the model, for an immediate first paint.

    The frontend fires this alongside the full analysis so the heatmap, hashes
    and metadata verdict appear in well under a second while Gemini is still
    thinking.
    """
    image, raw = await _read_image(file)
    evidence = await _local_evidence(image, raw, include_ela)
    return {
        "filename": file.filename,
        "content_type": file.content_type,
        "size_bytes": len(raw),
        "dimensions": {"width": image.width, "height": image.height},
        **evidence,
    }


class UrlRequest(BaseModel):
    url: str
    prompt: str | None = None
    include_ela: bool = True


async def _run_pipeline(
    image: Image.Image,
    raw: bytes,
    filename: str,
    content_type: str,
    prompt: str | None,
    include_ela: bool,
) -> dict:
    """The full forensic pass, shared by the upload and URL entry points."""
    safe_prompt, prompt_findings = prelint.lint_prompt(prompt)
    user_prompt = FORENSICS_SYSTEM_PROMPT
    if safe_prompt:
        user_prompt += f"\nAdditional analyst instructions: {safe_prompt}"

    evidence, model_result = await asyncio.gather(
        _local_evidence(image, raw, include_ela),
        asyncio.to_thread(_generate_report, image, user_prompt),
        return_exceptions=True,
    )

    if isinstance(evidence, BaseException):
        evidence = {"metadata": None, "fingerprint": None, "ela": None}
    if isinstance(model_result, BaseException):
        if isinstance(model_result, HTTPException):
            raise model_result
        raise HTTPException(
            status_code=502, detail=redact(f"Gemini analysis failed: {model_result}")
        )

    raw_report, model_used = model_result
    report, output_findings = prelint.lint_report(
        raw_report, metadata=evidence["metadata"], ela=evidence["ela"]
    )
    findings = prompt_findings + output_findings

    return {
        "filename": filename,
        "content_type": content_type,
        "size_bytes": len(raw),
        "dimensions": {"width": image.width, "height": image.height},
        "model": model_used,
        "key_mode": KEY_MODE,
        "report": report,
        "fingerprint": evidence["fingerprint"],
        "metadata": evidence["metadata"],
        "ela": evidence["ela"],
        "prelint": {**prelint.summarise(findings), "findings": findings},
    }


@app.post("/api/v1/analyze/url")
async def analyze_url(payload: UrlRequest):
    """Fetch a public image URL and run the full pipeline on the bytes.

    Same SSRF guards as /fetch-url, plus a JPEG/PNG/WebP allowlist and a 10 MB
    cap. The bytes go straight into the pipeline — nothing is written to disk.
    """
    if not API_KEY:
        raise HTTPException(
            status_code=503,
            detail="No API key configured. Set GOOGLE_API_KEY or PAID_GEMINI_API_KEY in backend/.env.",
        )
    try:
        raw, content_type, final_url = await fetch_url_service.fetch_image_async(payload.url)
    except fetch_url_service.FetchError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=redact(f"Fetch failed: {exc}"))

    try:
        image = Image.open(io.BytesIO(raw))
        image.load()
    except Exception:
        raise HTTPException(status_code=400, detail="The URL did not return a decodable image.")

    name = (urlparse(final_url).path.rsplit("/", 1)[-1] or "remote-image")[:120]
    if "." not in name:
        name = f"{name}.{(image.format or 'jpg').lower()}"

    result = await _run_pipeline(
        image, raw, name, content_type, payload.prompt, payload.include_ela
    )
    result["source_url"] = final_url
    return result


@app.post("/api/v1/forensics/analyze")
async def analyze_image(
    file: UploadFile = File(...),
    prompt: str | None = Form(None),
    include_ela: bool = Form(True),
):
    """Full forensic pass on an uploaded file."""
    if not API_KEY:
        raise HTTPException(
            status_code=503,
            detail="No API key configured. Set GOOGLE_API_KEY or PAID_GEMINI_API_KEY in backend/.env.",
        )
    image, raw = await _read_image(file)
    return await _run_pipeline(
        image, raw, file.filename, file.content_type, prompt, include_ela
    )
