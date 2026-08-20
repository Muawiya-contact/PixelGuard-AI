"""Canonical output vocabulary for PixelGuard reports."""

from .report import (  # noqa: F401
    MEDIA_TYPES,
    VERDICT_KEYS,
    VERDICT_LABELS,
    MEDIA_TYPE_LABELS,
    DEFAULT_VERDICT_FOR_MEDIA,
    normalise_media_type,
    normalise_verdict,
    resolve_verdict,
    verdict_label,
)
