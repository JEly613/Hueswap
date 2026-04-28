"""Palette preprocessor — converts raw hex palettes to OKLCH feature vectors.

Reads scraped palette JSONs from ml/data/raw/, converts hex colors to OKLCH
color space (matching culori's implementation), computes 6D feature vectors,
and writes train/validation splits to ml/data/processed/.

Usage:
    python ml/preprocess.py
"""

import json
import logging
import math
import random
from pathlib import Path
from typing import Optional

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)

RAW_DIR = Path(__file__).resolve().parent / "data" / "raw"
PROCESSED_DIR = Path(__file__).resolve().parent / "data" / "processed"
TRAIN_RATIO = 0.8
ACHROMATIC_THRESHOLD = 0.01


# ─── Hex → OKLCH conversion (matches culori exactly) ─────────────────────────


def hex_to_srgb(hex_color: str) -> Optional[tuple[float, float, float]]:
    """Parse a hex color string to sRGB components in [0, 1].

    Args:
        hex_color: A hex color string like '#aabbcc' or 'aabbcc'.

    Returns:
        Tuple of (r, g, b) floats in [0, 1], or None if invalid.
    """
    h = hex_color.lstrip("#")
    if len(h) != 6:
        return None
    try:
        r = int(h[0:2], 16) / 255.0
        g = int(h[2:4], 16) / 255.0
        b = int(h[4:6], 16) / 255.0
        return (r, g, b)
    except ValueError:
        return None


def srgb_to_linear(c: float) -> float:
    """Convert a single sRGB component to linear RGB.

    Uses the standard sRGB transfer function (same as culori).

    Args:
        c: sRGB component in [0, 1].

    Returns:
        Linear RGB component.
    """
    if abs(c) <= 0.04045:
        return c / 12.92
    return math.copysign(((abs(c) + 0.055) / 1.055) ** 2.4, c)


def linear_rgb_to_oklab(r: float, g: float, b: float) -> tuple[float, float, float]:
    """Convert linear RGB directly to OKLab.

    Uses culori's exact combined matrix (linear RGB → LMS → OKLab) to match
    culori's output precisely. This avoids the intermediate XYZ step and uses
    the same coefficients as culori's convertLrgbToOklab.js.

    Args:
        r: Linear red component.
        g: Linear green component.
        b: Linear blue component.

    Returns:
        Tuple of (L, a, b) in OKLab space.
    """
    # Linear RGB to LMS (culori's combined matrix, same as convertLrgbToOklab.js)
    l_ = math.cbrt(0.412221469470763 * r + 0.5363325372617348 * g + 0.0514459932675022 * b)
    m_ = math.cbrt(0.2119034958178252 * r + 0.6806995506452344 * g + 0.1073969535369406 * b)
    s_ = math.cbrt(0.0883024591900564 * r + 0.2817188391361215 * g + 0.6299787016738222 * b)

    # LMS to OKLab (culori's M2 matrix)
    L = 0.210454268309314 * l_ + 0.7936177747023054 * m_ - 0.0040720430116193 * s_
    a = 1.9779985324311684 * l_ - 2.4285922420485799 * m_ + 0.450593709617411 * s_
    b_val = 0.0259040424655478 * l_ + 0.7827717124575296 * m_ - 0.8086757549230774 * s_

    return (L, a, b_val)


def oklab_to_oklch(L: float, a: float, b: float) -> tuple[float, float, float]:
    """Convert OKLab to OKLCH.

    Args:
        L: OKLab lightness.
        a: OKLab a component.
        b: OKLab b component.

    Returns:
        Tuple of (L, C, H) where H is in degrees [0, 360).
    """
    C = math.sqrt(a * a + b * b)
    H = math.degrees(math.atan2(b, a))
    if H < 0:
        H += 360.0
    return (L, C, H)


def hex_to_oklch(hex_color: str) -> Optional[tuple[float, float, float]]:
    """Convert a hex color string to OKLCH.

    Follows the exact same pipeline as culori:
    hex → sRGB → linear RGB → OKLab → OKLCH.

    Args:
        hex_color: A hex color string like '#aabbcc'.

    Returns:
        Tuple of (L, C, H) or None if the hex string is invalid.
        L in [0, 1], C >= 0, H in [0, 360).
        For achromatic colors (C ≈ 0), H defaults to 0.
    """
    srgb = hex_to_srgb(hex_color)
    if srgb is None:
        return None

    r_lin = srgb_to_linear(srgb[0])
    g_lin = srgb_to_linear(srgb[1])
    b_lin = srgb_to_linear(srgb[2])

    L, a, b = linear_rgb_to_oklab(r_lin, g_lin, b_lin)
    L_out, C, H = oklab_to_oklch(L, a, b)

    # Match culori: achromatic colors get H=0 (NaN in culori → 0 in our TS code)
    if C < 1e-10:
        H = 0.0

    return (L_out, C, H)


# ─── Feature vector computation ───────────────────────────────────────────────


def is_warm(hue: float, chroma: float) -> int:
    """Classify a color as warm (1) or cool (0).

    Matches the TypeScript isWarm() in lib/color-math.ts:
    - Achromatic colors (chroma < 0.01) → cool (0)
    - Warm: hue in [0°, 60°] ∪ [330°, 360°)
    - Cool: hue in (60°, 330°)

    Args:
        hue: Hue in degrees [0, 360).
        chroma: OKLCH chroma value.

    Returns:
        1 if warm, 0 if cool.
    """
    if chroma < ACHROMATIC_THRESHOLD:
        return 0
    h = ((hue % 360) + 360) % 360
    return 1 if (h <= 60 or h >= 330) else 0


def compute_feature_vector(
    L: float,
    C: float,
    H: float,
    min_L: float,
    max_L: float,
    min_C: float,
    max_C: float,
) -> list[float]:
    """Compute the 6D feature vector for a color within its palette.

    Matches computeFeatureVector() in lib/color-math.ts:
    [L, C, H/360, normalized_L, normalized_C, is_warm]

    Args:
        L: OKLCH lightness in [0, 1].
        C: OKLCH chroma.
        H: OKLCH hue in degrees [0, 360).
        min_L: Minimum lightness in the palette.
        max_L: Maximum lightness in the palette.
        min_C: Minimum chroma in the palette.
        max_C: Maximum chroma in the palette.

    Returns:
        6-element list: [L, C, H/360, normalized_L, normalized_C, is_warm].
    """
    range_L = max_L - min_L
    range_C = max_C - min_C

    normalized_L = (L - min_L) / range_L if range_L > 0 else 0.5
    normalized_C = (C - min_C) / range_C if range_C > 0 else 0.5

    return [
        L,
        C,
        H / 360.0,
        normalized_L,
        normalized_C,
        is_warm(H, C),
    ]


# ─── Palette processing ──────────────────────────────────────────────────────


def process_palette(colors: list[str]) -> Optional[dict]:
    """Process a raw palette of hex colors into OKLCH values and feature vectors.

    Args:
        colors: List of hex color strings (expected length 4).

    Returns:
        Dict with 'hex', 'oklch', and 'features' keys, or None if any
        color fails conversion.
    """
    oklch_values: list[list[float]] = []

    for hex_color in colors:
        result = hex_to_oklch(hex_color)
        if result is None:
            logger.warning("Invalid hex color '%s', skipping palette", hex_color)
            return None
        oklch_values.append(list(result))

    # Compute palette ranges for normalization
    Ls = [c[0] for c in oklch_values]
    Cs = [c[1] for c in oklch_values]
    min_L, max_L = min(Ls), max(Ls)
    min_C, max_C = min(Cs), max(Cs)

    features: list[list[float]] = []
    for L, C, H in oklch_values:
        fv = compute_feature_vector(L, C, H, min_L, max_L, min_C, max_C)
        features.append(fv)

    return {
        "hex": colors,
        "oklch": oklch_values,
        "features": features,
    }


def load_raw_palettes(raw_dir: Path) -> list[list[str]]:
    """Load all raw palette JSON files from a directory.

    Args:
        raw_dir: Path to directory containing palette JSON files.

    Returns:
        List of palettes, each a list of hex color strings.
    """
    palettes: list[list[str]] = []
    if not raw_dir.exists():
        logger.warning("Raw data directory does not exist: %s", raw_dir)
        return palettes

    json_files = sorted(raw_dir.glob("*.json"))
    for filepath in json_files:
        try:
            with open(filepath) as f:
                data = json.load(f)
            colors = data.get("colors", [])
            if isinstance(colors, list) and len(colors) == 4:
                palettes.append(colors)
            else:
                logger.warning("Skipping %s: expected 4 colors, got %s", filepath.name, len(colors))
        except (json.JSONDecodeError, KeyError) as exc:
            logger.warning("Skipping %s: %s", filepath.name, exc)

    return palettes


def preprocess_palettes(
    raw_dir: Path = RAW_DIR,
    processed_dir: Path = PROCESSED_DIR,
    train_ratio: float = TRAIN_RATIO,
    seed: int = 42,
) -> tuple[int, int]:
    """Run the full preprocessing pipeline.

    Reads raw palettes, converts to OKLCH + feature vectors, splits into
    train/validation sets, and writes output files.

    Args:
        raw_dir: Directory containing raw palette JSON files.
        processed_dir: Directory to write processed output files.
        train_ratio: Fraction of palettes for training (rest for validation).
        seed: Random seed for reproducible train/val split.

    Returns:
        Tuple of (train_count, val_count).
    """
    raw_palettes = load_raw_palettes(raw_dir)
    logger.info("Loaded %d raw palettes from %s", len(raw_palettes), raw_dir)

    processed: list[dict] = []
    skipped = 0
    for colors in raw_palettes:
        result = process_palette(colors)
        if result is not None:
            processed.append(result)
        else:
            skipped += 1

    logger.info(
        "Processed %d palettes (%d skipped due to invalid colors)",
        len(processed),
        skipped,
    )

    if not processed:
        logger.warning("No palettes to write")
        return (0, 0)

    # Shuffle and split
    rng = random.Random(seed)
    rng.shuffle(processed)
    split_idx = int(len(processed) * train_ratio)
    train_data = processed[:split_idx]
    val_data = processed[split_idx:]

    # Write output
    processed_dir.mkdir(parents=True, exist_ok=True)

    train_path = processed_dir / "palettes_train.json"
    val_path = processed_dir / "palettes_val.json"

    with open(train_path, "w") as f:
        json.dump(train_data, f, indent=2)
    with open(val_path, "w") as f:
        json.dump(val_data, f, indent=2)

    logger.info(
        "Wrote %d train palettes to %s", len(train_data), train_path
    )
    logger.info(
        "Wrote %d validation palettes to %s", len(val_data), val_path
    )

    return (len(train_data), len(val_data))


def main() -> None:
    """Entry point for standalone execution."""
    train_count, val_count = preprocess_palettes()
    logger.info(
        "Preprocessing complete: %d train, %d validation palettes",
        train_count,
        val_count,
    )


if __name__ == "__main__":
    main()
