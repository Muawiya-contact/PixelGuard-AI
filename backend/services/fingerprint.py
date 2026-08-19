"""Structural fingerprinting: identity, geometry and colour statistics.

None of this is a detector. It is the descriptive record that makes a forensic
certificate checkable by someone else: the SHA-256 identifies the exact bytes
that were analysed, and the geometry and colour summaries let a reader confirm
the certificate refers to the image in front of them.
"""

import hashlib
from math import gcd

from PIL import Image

# Ratios a reader recognises on sight, matched within a small tolerance.
_NAMED_RATIOS = (
    (1 / 1, "1:1 square"),
    (4 / 3, "4:3 standard"),
    (3 / 2, "3:2 classic 35mm"),
    (16 / 10, "16:10"),
    (16 / 9, "16:9 widescreen"),
    (21 / 9, "21:9 ultrawide"),
    (9 / 16, "9:16 vertical"),
    (2 / 3, "2:3 portrait"),
    (3 / 4, "3:4 portrait"),
)


def _aspect(width: int, height: int) -> dict:
    if width <= 0 or height <= 0:
        return {"ratio": None, "simplified": None, "name": None, "orientation": "unknown"}

    divisor = gcd(width, height)
    simple_w, simple_h = width // divisor, height // divisor
    ratio = width / height

    name = None
    for target, label in _NAMED_RATIOS:
        # 1.5% tolerance absorbs the odd off-by-one from cropping/resizing.
        if abs(ratio - target) / target < 0.015:
            name = label
            break

    if simple_w > 40 or simple_h > 40:
        # An unreduced ratio like 899:601 tells a reader nothing.
        simplified = f"~{ratio:.3f}:1"
    else:
        simplified = f"{simple_w}:{simple_h}"

    orientation = "square" if width == height else ("landscape" if width > height else "portrait")
    return {"ratio": round(ratio, 4), "simplified": simplified, "name": name, "orientation": orientation}


def _colour_profile(image: Image.Image, top_n: int = 5) -> dict:
    """Mean/extreme channel statistics plus the dominant colours by area."""
    rgb = image.convert("RGB")

    # Thumbnail first: colour proportions survive downsampling, and this keeps
    # a 50-megapixel upload from turning into a multi-second histogram pass.
    sample = rgb.copy()
    sample.thumbnail((320, 320), Image.LANCZOS)

    pixels = sample.width * sample.height
    if pixels == 0:
        return {"dominant": [], "mean_rgb": None, "channel_balance": None}

    # Quantize to a small palette so "dominant" means a colour region a human
    # would actually see, not one exact 24-bit value.
    quantized = sample.quantize(colors=16, method=Image.MEDIANCUT)
    palette = quantized.getpalette() or []
    counts = sorted(quantized.getcolors() or [], reverse=True)

    dominant = []
    for count, index in counts[:top_n]:
        base = index * 3
        if base + 2 >= len(palette):
            continue
        r, g, b = palette[base], palette[base + 1], palette[base + 2]
        dominant.append({
            "hex": f"#{r:02x}{g:02x}{b:02x}",
            "rgb": [r, g, b],
            "share": round(count / pixels, 4),
        })

    stats = sample.split()
    means = [round(sum(i * c for i, c in enumerate(ch.histogram())) / pixels, 1) for ch in stats]
    total = sum(means) or 1
    balance = {
        "r": round(means[0] / total, 3),
        "g": round(means[1] / total, 3),
        "b": round(means[2] / total, 3),
    }

    return {
        "dominant": dominant,
        "mean_rgb": {"r": means[0], "g": means[1], "b": means[2]},
        "channel_balance": balance,
        "sampled_from": {"width": sample.width, "height": sample.height},
    }


def fingerprint(image: Image.Image, raw: bytes) -> dict:
    """Identity, geometry and colour summary for the exact bytes supplied."""
    digest = hashlib.sha256(raw).hexdigest()
    return {
        "sha256": digest,
        # Grouped rendering is far easier to read aloud or compare by eye.
        "sha256_grouped": " ".join(digest[i:i + 8] for i in range(0, len(digest), 8)),
        "md5": hashlib.md5(raw).hexdigest(),
        "byte_size": len(raw),
        "format": image.format,
        "mode": image.mode,
        "dimensions": {"width": image.width, "height": image.height},
        "megapixels": round((image.width * image.height) / 1_000_000, 2),
        "aspect": _aspect(image.width, image.height),
        "colour": _colour_profile(image),
    }
