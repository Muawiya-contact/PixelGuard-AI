"""Error Level Analysis (ELA).

Re-encoding a JPEG at a known quality degrades untouched regions predictably.
Regions that were spliced, cloned, or painted in have a different compression
history, so they shed a different amount of error on re-encode and light up
against the background.

Implemented with Pillow + NumPy rather than OpenCV: the only OpenCV call this
would need is applyColorMap, which is a few lines of NumPy, and opencv-python
would add tens of megabytes to an image that has to cold-start on Render's
free tier.
"""

import base64
import io

import numpy as np
from PIL import Image, ImageChops

# Perceptually-ordered stops (dark -> blue -> green -> yellow -> red -> white).
# Low error stays dark and recedes; high error reads hot.
_COLORMAP_STOPS = [
    (0.00, (8, 8, 24)),
    (0.15, (26, 44, 120)),
    (0.35, (24, 140, 130)),
    (0.55, (120, 200, 70)),
    (0.75, (250, 205, 60)),
    (0.90, (238, 92, 42)),
    (1.00, (255, 245, 235)),
]


def _colormap(gray: np.ndarray) -> np.ndarray:
    """Map a float array in [0, 1] to RGB uint8 via piecewise-linear stops."""
    positions = np.array([s[0] for s in _COLORMAP_STOPS])
    colors = np.array([s[1] for s in _COLORMAP_STOPS], dtype=np.float64)
    flat = np.clip(gray, 0.0, 1.0).ravel()
    idx = np.clip(np.searchsorted(positions, flat, side="right") - 1, 0, len(positions) - 2)
    span = positions[idx + 1] - positions[idx]
    t = np.where(span > 0, (flat - positions[idx]) / np.where(span > 0, span, 1), 0.0)
    rgb = colors[idx] + (colors[idx + 1] - colors[idx]) * t[:, None]
    return rgb.reshape(gray.shape + (3,)).astype(np.uint8)


def _to_data_uri(image: Image.Image) -> str:
    buf = io.BytesIO()
    image.save(buf, format="PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def compute_ela(
    image: Image.Image,
    quality: int = 90,
    max_side: int = 1400,
) -> dict:
    """Run ELA and return a heatmap data URI plus quantitative metrics.

    quality: JPEG quality used for the probe re-encode. 90 is the usual choice —
    high enough that authentic regions stay quiet, low enough to expose edits.
    max_side: downscale guard so a huge upload cannot blow up memory.
    """
    source = image.convert("RGB")
    if max(source.size) > max_side:
        ratio = max_side / max(source.size)
        source = source.resize(
            (max(1, int(source.width * ratio)), max(1, int(source.height * ratio))),
            Image.LANCZOS,
        )

    buf = io.BytesIO()
    source.save(buf, format="JPEG", quality=quality)
    buf.seek(0)
    recompressed = Image.open(buf)
    recompressed.load()

    diff = ImageChops.difference(source, recompressed)
    arr = np.asarray(diff, dtype=np.float32)

    # Per-pixel error magnitude across channels.
    err = arr.max(axis=2)
    peak = float(err.max())
    # Normalise against the observed peak so faint tampering is still visible;
    # guard the all-black case (a synthetic image can re-encode losslessly).
    norm = err / peak if peak > 0 else np.zeros_like(err)

    heat = Image.fromarray(_colormap(norm), mode="RGB")

    mean_err = float(err.mean())
    std_err = float(err.std())
    # Fraction of the frame whose error sits far above the frame's own baseline.
    threshold = mean_err + 3.0 * std_err if std_err > 0 else peak
    hot_ratio = float((err > threshold).mean()) if peak > 0 else 0.0

    # Coarse 6x6 tiling. A splice shows up as a tile whose error departs from
    # the frame's baseline in EITHER direction: freshly painted pixels shed more
    # error, while a patch carried over from a heavily-compressed source sheds
    # less. Measuring only "hotter" would miss half of real edits.
    tiles = []
    h, w = err.shape
    grid = 6
    for ty in range(grid):
        for tx in range(grid):
            y0, y1 = ty * h // grid, (ty + 1) * h // grid
            x0, x1 = tx * w // grid, (tx + 1) * w // grid
            block = err[y0:y1, x0:x1]
            if block.size:
                tiles.append(float(block.mean()))
    tile_spread = float(np.std(tiles)) if tiles else 0.0

    # Rank tiles by how far they sit from the frame's baseline, in either
    # direction, and hand the top few to the reviewer as places to look. This is
    # deliberately NOT a verdict: measured on known-ground-truth composites these
    # statistics did not separate spliced images from clean ones (clean untouched
    # frames frequently score higher), which matches ELA's reputation in the
    # literature. The heatmap is evidence for a human to read; the numbers only
    # direct attention.
    focus_regions = []
    if tiles:
        baseline = float(np.median(tiles))
        scored = []
        for i, value in enumerate(tiles):
            scored.append((abs(value - baseline), i, value))
        scored.sort(reverse=True)
        for deviation, i, value in scored[:3]:
            if baseline > 0 and deviation / baseline < 0.25:
                continue  # too close to baseline to be worth pointing at
            scored_row, scored_col = divmod(i, grid)
            focus_regions.append({
                "row": scored_row,
                "col": scored_col,
                "grid": grid,
                "mean_error": round(value, 3),
                "direction": "higher" if value > baseline else "lower",
            })

    return {
        "heatmap": _to_data_uri(heat),
        "quality": quality,
        "dimensions": {"width": source.width, "height": source.height},
        "metrics": {
            "mean_error": round(mean_err, 3),
            "max_error": round(peak, 3),
            "std_error": round(std_err, 3),
            "hot_pixel_ratio": round(hot_ratio, 5),
            "tile_spread": round(tile_spread, 3),
        },
        "focus_regions": focus_regions,
        "interpretation": _interpret(mean_err, hot_ratio, peak),
    }


def _interpret(mean_err: float, hot_ratio: float, peak: float) -> dict:
    """Describe the error field. Deliberately makes no tampering claim.

    ELA is a visualisation, not a classifier. Benchmarked against composites
    built here with known ground truth, tile statistics did not separate edited
    frames from clean ones — untouched images with fine texture routinely score
    as "anomalous". Anything stronger than a description would be overclaiming,
    so the caller gets the heatmap, the numbers, and an explicit caveat.
    """
    caveat = (
        "ELA is suggestive only and must be read visually, not taken as a verdict. "
        "Texture, resizing, and repeated saving all raise error without any editing, "
        "and a skilled edit re-saved at the same quality leaves no ELA trace at all."
    )
    if peak == 0:
        return {
            "signal": "no_signal",
            "note": "The image re-encoded losslessly, so ELA yields nothing. Typical of "
                    "synthetic graphics or flat colour rather than camera output.",
            "caveat": caveat,
        }
    if mean_err > 12:
        signal, note = "high_error", (
            "Error is high across the whole frame — usually repeated re-saving or a "
            "low-quality source, not a localised edit."
        )
    elif hot_ratio > 0.02:
        signal, note = "textured", (
            "A noticeable fraction of the frame carries high error. Common in detailed "
            "or high-frequency imagery; inspect the heatmap for structure that follows "
            "an object boundary rather than the texture."
        )
    else:
        signal, note = "low_error", (
            "Error is low and evenly distributed. Nothing stands out, though this does "
            "not rule out an edit."
        )
    return {"signal": signal, "note": note, "caveat": caveat}
