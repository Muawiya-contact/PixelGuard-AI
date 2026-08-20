"""C2PA / EXIF / XMP metadata forensics.

Metadata is the highest-signal evidence available when it survives: a C2PA
manifest or a Stable Diffusion parameter block states provenance outright,
where pixel analysis can only infer it. It is also the most fragile — every
social platform strips it on upload — so absence proves nothing. Callers must
treat a null result as "unknown", never as "authentic".
"""

import json
import re
from typing import Any

from PIL import ExifTags, Image

# Byte markers scanned in the raw file. C2PA manifests live in a JUMBF box that
# Pillow does not surface, so the container is searched directly.
_C2PA_MARKERS = (b"c2pa", b"jumbf", b"urn:uuid:", b"contentauth")

# key -> (label, list of case-insensitive needles)
_AI_SIGNATURES: dict[str, tuple[str, tuple[str, ...]]] = {
    "stable_diffusion": ("Stable Diffusion", ("stable diffusion", "sd-webui", "automatic1111", "sampler:", "cfg scale", "denoising strength")),
    "comfyui": ("ComfyUI", ("comfyui", "comfy_ui")),
    "midjourney": ("Midjourney", ("midjourney", "job id")),
    "dalle": ("DALL·E / OpenAI", ("dall-e", "dalle", "openai")),
    "firefly": ("Adobe Firefly", ("firefly", "adobe firefly")),
    "google_ai": ("Google (Imagen / SynthID)", ("synthid", "imagen", "made with google ai")),
    "flux": ("FLUX", ("flux.1", "black forest labs")),
    "leonardo": ("Leonardo.ai", ("leonardo.ai", "leonardoai")),
    "nightcafe": ("NightCafe", ("nightcafe",)),
    "generic_ai": ("Unspecified generative model", ("ai-generated", "ai generated", "generative ai", "text-to-image")),
}

# Editors leave their mark without implying generation.
_EDITOR_SIGNATURES = (
    ("Adobe Photoshop", ("photoshop",)),
    ("GIMP", ("gimp",)),
    ("Lightroom", ("lightroom",)),
    ("Affinity Photo", ("affinity",)),
    ("Snapseed", ("snapseed",)),
    ("Canva", ("canva",)),
)

_CAMERA_TAGS = ("Make", "Model", "LensModel", "DateTimeOriginal", "ExposureTime", "FNumber", "ISOSpeedRatings", "FocalLength")


def _stringify(value: Any) -> str:
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return str(value)


def _extract_exif(image: Image.Image) -> dict:
    """Pull EXIF into a plain {tag_name: str} dict, tolerating malformed blocks."""
    out: dict[str, str] = {}
    try:
        exif = image.getexif()
    except Exception:
        return out
    if not exif:
        return out

    for tag_id, value in exif.items():
        name = ExifTags.TAGS.get(tag_id, f"Tag{tag_id}")
        try:
            text = _stringify(value)
        except Exception:
            continue
        if len(text) > 2000:
            text = text[:2000] + "…"
        out[name] = text

    # IFD pointers hold the interesting capture settings.
    for ifd_name, ifd_id in (("Exif", 0x8769), ("GPS", 0x8825)):
        try:
            sub = exif.get_ifd(ifd_id)
        except Exception:
            continue
        for tag_id, value in (sub or {}).items():
            table = ExifTags.GPSTAGS if ifd_name == "GPS" else ExifTags.TAGS
            name = table.get(tag_id, f"{ifd_name}Tag{tag_id}")
            try:
                text = _stringify(value)
            except Exception:
                continue
            out.setdefault(name, text[:2000])
    return out


def _extract_png_text(image: Image.Image) -> dict:
    """PNG tEXt/iTXt chunks — where SD/ComfyUI write their generation params."""
    out: dict[str, str] = {}
    for key, value in (getattr(image, "info", {}) or {}).items():
        if isinstance(value, (str, bytes)) and key.lower() not in {"icc_profile", "exif"}:
            text = _stringify(value)
            if text.strip():
                out[key] = text[:4000]
    return out


def _find_xmp(raw: bytes) -> str | None:
    match = re.search(rb"<x:xmpmeta.*?</x:xmpmeta>", raw, re.DOTALL)
    if not match:
        return None
    return match.group(0).decode("utf-8", errors="replace")[:8000]


def _detect_c2pa(raw: bytes, xmp: str | None) -> dict:
    """Detect a Content Credentials manifest.

    Presence is reported, not validated: verifying the certificate chain needs
    the c2pa library and a trust list. An unvalidated manifest can be forged,
    so this is labelled as such rather than treated as proof.
    """
    hits = [m.decode("ascii", "replace") for m in _C2PA_MARKERS if m in raw.lower()]
    xmp_claim = bool(xmp and re.search(r"c2pa|contentauth|claim_generator", xmp, re.IGNORECASE))
    present = bool(hits) or xmp_claim

    generator = None
    if xmp:
        gen = re.search(r"claim_generator[\"'>:\s]+([^<\"'\n]{3,120})", xmp, re.IGNORECASE)
        if gen:
            generator = gen.group(1).strip()

    return {
        "present": present,
        "validated": False,
        "claim_generator": generator,
        "markers": sorted(set(hits)),
        "note": (
            "A C2PA manifest is present but NOT cryptographically validated — signature "
            "and trust-list verification require the c2pa library. Treat as a claim, not proof."
            if present
            else "No C2PA manifest found. Note that most platforms strip Content Credentials "
                 "on upload, so absence is not evidence of tampering."
        ),
    }


def _scan_signatures(haystack: str, raw: bytes = b"") -> tuple[list[dict], list[str]]:
    """Scan parsed metadata and, as a fallback, the raw container.

    Generator strings also live in boxes Pillow does not decode — JUMBF, IPTC,
    MakerNote — so the raw bytes are searched too. Each hit records where it
    came from, since a raw-container match is weaker evidence than a parsed
    field and should be weighted accordingly by a reviewer.
    """
    lowered = haystack.lower()
    raw_lowered = raw[:4_000_000].lower()  # bounded so a huge upload cannot stall the scan

    ai_hits: list[dict] = []
    for key, (label, needles) in _AI_SIGNATURES.items():
        in_meta = [n for n in needles if n in lowered]
        # Only needles specific enough to be meaningful in arbitrary binary.
        in_raw = [n for n in needles if len(n) >= 6 and n.encode() in raw_lowered]
        matched = sorted(set(in_meta) | set(in_raw))
        if matched:
            ai_hits.append({
                "id": key,
                "label": label,
                "matched_on": matched[:4],
                "source": "metadata" if in_meta else "raw_container",
            })

    editors = [
        label
        for label, needles in _EDITOR_SIGNATURES
        if any(n in lowered for n in needles)
        or any(len(n) >= 6 and n.encode() in raw_lowered for n in needles)
    ]
    return ai_hits, editors


def parse_metadata(image: Image.Image, raw: bytes) -> dict:
    """Inspect EXIF, PNG text chunks, XMP and C2PA markers for provenance."""
    exif = _extract_exif(image)
    png_text = _extract_png_text(image)
    xmp = _find_xmp(raw)
    c2pa = _detect_c2pa(raw, xmp)

    haystack = "\n".join(
        [json.dumps(exif, ensure_ascii=False), json.dumps(png_text, ensure_ascii=False), xmp or ""]
    )
    ai_signatures, editors = _scan_signatures(haystack, raw)

    camera_fields = {k: v for k, v in exif.items() if k in _CAMERA_TAGS}
    has_camera_evidence = len(camera_fields) >= 2
    has_gps = any(k.startswith("GPS") for k in exif)

    if ai_signatures:
        verdict = "ai_generated"
        from_metadata = any(h["source"] == "metadata" for h in ai_signatures)
        confidence = "high" if from_metadata else "medium"
        where = "parsed metadata" if from_metadata else "the raw container only"
        rationale = (
            f"Generator signature found in {where}: "
            f"{', '.join(h['label'] for h in ai_signatures)}."
        )
    elif c2pa["present"]:
        verdict = "c2pa_claim_present"
        confidence = "medium"
        rationale = "A Content Credentials manifest is attached but was not validated here."
    elif has_camera_evidence:
        verdict = "camera_capture_indicated"
        confidence = "medium"
        rationale = f"EXIF carries capture fields ({', '.join(sorted(camera_fields)[:4])}). Consistent with a real camera, though EXIF is trivially forged."
    elif not exif and not png_text and not xmp:
        verdict = "no_metadata"
        confidence = "none"
        rationale = "No metadata survives. Common after upload to any social platform — uninformative either way."
    else:
        verdict = "inconclusive"
        confidence = "low"
        rationale = "Metadata present but carries no generator or capture markers."

    return {
        "verdict": verdict,
        "confidence": confidence,
        "rationale": rationale,
        "c2pa": c2pa,
        "ai_signatures": ai_signatures,
        "editing_software": editors,
        "camera_evidence": {
            "present": has_camera_evidence,
            "fields": camera_fields,
            "has_gps": has_gps,
        },
        "raw": {
            "exif": exif,
            "png_text": {k: (v[:600] + "…" if len(v) > 600 else v) for k, v in png_text.items()},
            "xmp_present": xmp is not None,
        },
    }
