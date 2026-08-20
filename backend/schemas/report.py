"""Verdict and media-type vocabulary.

The report carries both forms of every classification:

* ``verdict`` is the human-facing string the spec dictates, verbatim
  ("Authentic Digital Art", "Inconclusive / Human Review Needed"), because that
  is what a reader and a certificate must show.
* ``verdict_key`` is a stable snake_case token. All internal logic — prelint
  rules, UI styling, PDF colour selection — keys off this. Branching on a
  display string means a stray space or a copy-edit silently changes behaviour.

Keeping both means the wording can be revised without touching a single
conditional.
"""

# --- media types ---------------------------------------------------------
MEDIA_TYPES = ("photograph", "digital_art_illustration", "ai_synthetic", "unknown")

MEDIA_TYPE_LABELS = {
    "photograph": "Photograph",
    "digital_art_illustration": "Digital Art / Illustration",
    "ai_synthetic": "AI Synthetic",
    "unknown": "Unknown",
}

# --- verdicts ------------------------------------------------------------
VERDICT_KEYS = (
    "authentic_photograph",
    "authentic_digital_art",
    "ai_generated",
    "manipulated",
    "inconclusive",
)

VERDICT_LABELS = {
    "authentic_photograph": "Authentic Photograph",
    "authentic_digital_art": "Authentic Digital Art",
    "ai_generated": "AI Generated",
    "manipulated": "Manipulated",
    "inconclusive": "Inconclusive / Human Review Needed",
}

DEFAULT_VERDICT_FOR_MEDIA = {
    "photograph": "authentic_photograph",
    "digital_art_illustration": "authentic_digital_art",
    "ai_synthetic": "ai_generated",
    "unknown": "inconclusive",
}

# Everything a model has been observed to return, mapped onto a canonical key.
# Generous by design: a model that answers "Authentic Photo" or "authentic"
# should not fall through to "inconclusive" on a formatting difference.
_VERDICT_ALIASES = {
    "authentic_photograph": "authentic_photograph",
    "authenticphotograph": "authentic_photograph",
    "authentic_photo": "authentic_photograph",
    "photograph": "authentic_photograph",
    "real_photograph": "authentic_photograph",
    "authentic_digital_art": "authentic_digital_art",
    "authenticdigitalart": "authentic_digital_art",
    "digital_art": "authentic_digital_art",
    "digital_art_illustration": "authentic_digital_art",
    "illustration": "authentic_digital_art",
    "ai_generated": "ai_generated",
    "aigenerated": "ai_generated",
    "ai": "ai_generated",
    "ai_synthetic": "ai_generated",
    "synthetic": "ai_generated",
    "generated": "ai_generated",
    "manipulated": "manipulated",
    "tampered": "manipulated",
    "edited": "manipulated",
    "inconclusive": "inconclusive",
    "inconclusive_human_review_needed": "inconclusive",
    "human_review_needed": "inconclusive",
    "unknown": "inconclusive",
}

_MEDIA_ALIASES = {
    "photograph": "photograph",
    "photo": "photograph",
    "real_photograph": "photograph",
    "camera": "photograph",
    "digital_art_illustration": "digital_art_illustration",
    "digital_art": "digital_art_illustration",
    "digitalart": "digital_art_illustration",
    "illustration": "digital_art_illustration",
    "artwork": "digital_art_illustration",
    "anime": "digital_art_illustration",
    "vector": "digital_art_illustration",
    "graphic_design": "digital_art_illustration",
    "ai_synthetic": "ai_synthetic",
    "aisynthetic": "ai_synthetic",
    "ai_generated": "ai_synthetic",
    "synthetic": "ai_synthetic",
}


def _slug(value) -> str:
    text = str(value or "").strip().lower()
    for ch in (" ", "-", "/", ".", ":"):
        text = text.replace(ch, "_")
    while "__" in text:
        text = text.replace("__", "_")
    return text.strip("_")


def normalise_verdict(value) -> str | None:
    """Map any observed verdict spelling onto a canonical key, or None."""
    return _VERDICT_ALIASES.get(_slug(value))


def normalise_media_type(value) -> str | None:
    """Map any observed media-type spelling onto a canonical key, or None."""
    return _MEDIA_ALIASES.get(_slug(value))


def verdict_label(key: str) -> str:
    return VERDICT_LABELS.get(key, VERDICT_LABELS["inconclusive"])


def resolve_verdict(raw_verdict, media_type: str | None) -> str:
    """Pick a canonical verdict from what the model said plus the media type.

    A bare "Authentic" is genuinely ambiguous under a three-tier scheme — it
    could mean a photograph or a human illustration — so the media type decides.
    That is also what makes RULE 1 possible: the model does not have to get the
    compound label right, only the media type.
    """
    key = normalise_verdict(raw_verdict)
    if key:
        return key

    slug = _slug(raw_verdict)
    if slug.startswith("authentic") or slug in ("real", "genuine", "clean"):
        return DEFAULT_VERDICT_FOR_MEDIA.get(media_type or "unknown", "inconclusive")
    return "inconclusive"
