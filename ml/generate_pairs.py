"""Palette pair generator — creates algorithmically labeled training pairs.

Reads processed palettes from ml/data/processed/, forms palette pairs,
matches colors by Role_Vector similarity (Euclidean distance over
[normalized_L, normalized_C, is_warm]), and writes curriculum-ordered
training examples to ml/data/processed/pairs_train.json and pairs_val.json.

Usage:
    python ml/generate_pairs.py
"""

import json
import logging
import math
import sys
from pathlib import Path
from typing import Optional

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)

PROCESSED_DIR = Path(__file__).resolve().parent / "data" / "processed"
MIN_PALETTES = 100
# Number of nearest-neighbor palettes to pair each palette with
K_NEIGHBORS = 5
# Role_Vector indices within the 6D feature vector
ROLE_VECTOR_INDICES = (3, 4, 5)  # normalized_L, normalized_C, is_warm


# ─── Role_Vector helpers ──────────────────────────────────────────────────────


def role_vector(feature: list[float]) -> tuple[float, float, float]:
    """Extract the Role_Vector from a 6D feature vector.

    The Role_Vector is [normalized_L, normalized_C, is_warm] at indices [3, 4, 5].

    Args:
        feature: A 6D feature vector [L, C, H/360, normalized_L, normalized_C, is_warm].

    Returns:
        Tuple of (normalized_L, normalized_C, is_warm).
    """
    return (feature[3], feature[4], feature[5])


def role_vector_distance(a: list[float], b: list[float]) -> float:
    """Compute Euclidean distance between two colors' Role_Vectors.

    Args:
        a: 6D feature vector for color A.
        b: 6D feature vector for color B.

    Returns:
        Euclidean distance over [normalized_L, normalized_C, is_warm].
    """
    ra = role_vector(a)
    rb = role_vector(b)
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(ra, rb)))


def palette_role_vector_centroid(features: list[list[float]]) -> list[float]:
    """Compute the mean Role_Vector for a palette.

    Args:
        features: List of 6D feature vectors for a palette.

    Returns:
        Mean [normalized_L, normalized_C, is_warm] as a list of 3 floats.
    """
    n = len(features)
    centroid = [0.0, 0.0, 0.0]
    for feat in features:
        rv = role_vector(feat)
        for i in range(3):
            centroid[i] += rv[i]
    return [v / n for v in centroid]


def palette_centroid_distance(
    features_a: list[list[float]], features_b: list[list[float]]
) -> float:
    """Compute Euclidean distance between two palettes' Role_Vector centroids.

    Args:
        features_a: List of 6D feature vectors for palette A.
        features_b: List of 6D feature vectors for palette B.

    Returns:
        Euclidean distance between the two centroids.
    """
    ca = palette_role_vector_centroid(features_a)
    cb = palette_role_vector_centroid(features_b)
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(ca, cb)))


# ─── Hue-preserving helpers ──────────────────────────────────────────────────


def circular_hue_distance(h1: float, h2: float) -> float:
    """Compute circular distance between two hue angles in degrees.

    Returns the shortest angular distance on the 360° color wheel,
    i.e. ``min(|h1 - h2|, 360 - |h1 - h2|)``.

    Args:
        h1: First hue angle in [0, 360).
        h2: Second hue angle in [0, 360).

    Returns:
        Distance in [0, 180].
    """
    diff = abs(h1 - h2)
    return min(diff, 360.0 - diff)


def hue_preserving_distance(
    src_oklch: list[float],
    tgt_oklch: list[float],
    achromatic_threshold: float = 0.01,
) -> float:
    """Distance metric for hue-preserving matching.

    For chromatic colors (both chroma ≥ threshold): circular hue distance.
    For achromatic colors (either chroma < threshold): lightness distance
    scaled to [0, 180] so it is comparable with hue distance.

    Args:
        src_oklch: Source color as [L, C, H] where L ∈ [0, 1], C ≥ 0, H ∈ [0, 360).
        tgt_oklch: Target color as [L, C, H] where L ∈ [0, 1], C ≥ 0, H ∈ [0, 360).
        achromatic_threshold: Chroma below which a color is considered achromatic.

    Returns:
        Non-negative distance. In [0, 180] for chromatic pairs (hue distance)
        or achromatic pairs (lightness distance × 180).
    """
    src_L, src_C, src_H = src_oklch
    tgt_L, tgt_C, tgt_H = tgt_oklch

    src_achromatic = src_C < achromatic_threshold
    tgt_achromatic = tgt_C < achromatic_threshold

    if src_achromatic or tgt_achromatic:
        return abs(src_L - tgt_L) * 180.0

    return circular_hue_distance(src_H, tgt_H)


def match_colors_hue_preserving(
    src_oklch: list[list[float]], tgt_oklch: list[list[float]]
) -> list[tuple[int, int]]:
    """Match source to target colors by greedy hue-preserving distance.

    For each source color (in order), finds the closest unmatched target color
    by ``hue_preserving_distance``.  Produces a bijection: each source color
    is matched to exactly one target color and vice versa.

    Args:
        src_oklch: Source palette as list of [L, C, H] triples (length N).
        tgt_oklch: Target palette as list of [L, C, H] triples (length N).

    Returns:
        List of (src_idx, tgt_idx) pairs forming a bijection.
    """
    unmatched_tgt = list(range(len(tgt_oklch)))
    matches: list[tuple[int, int]] = []

    for src_idx in range(len(src_oklch)):
        best_tgt_idx = min(
            unmatched_tgt,
            key=lambda ti: hue_preserving_distance(src_oklch[src_idx], tgt_oklch[ti]),
        )
        matches.append((src_idx, best_tgt_idx))
        unmatched_tgt.remove(best_tgt_idx)

    return matches


def average_hue_match_distance(
    src_oklch: list[list[float]],
    tgt_oklch: list[list[float]],
    matches: list[tuple[int, int]],
) -> float:
    """Compute average hue-preserving distance across matched pairs.

    Used for curriculum ordering: pairs with lower average hue distance
    (more similar hues) appear earlier in training.

    Args:
        src_oklch: Source palette as list of [L, C, H] triples.
        tgt_oklch: Target palette as list of [L, C, H] triples.
        matches: List of (src_idx, tgt_idx) pairs from hue-preserving matching.

    Returns:
        Average ``hue_preserving_distance`` across all matched pairs,
        or 0.0 if *matches* is empty.
    """
    if not matches:
        return 0.0
    total = sum(
        hue_preserving_distance(src_oklch[si], tgt_oklch[ti])
        for si, ti in matches
    )
    return total / len(matches)


# ─── Color matching ───────────────────────────────────────────────────────────


def match_colors_greedy(
    src_features: list[list[float]], tgt_features: list[list[float]]
) -> list[tuple[int, int]]:
    """Match source colors to target colors by greedy Role_Vector similarity.

    For each source color (in order), finds the closest unmatched target color
    by Euclidean distance over [normalized_L, normalized_C, is_warm].
    Produces a bijection: each source color matched to exactly one target color.

    Args:
        src_features: List of 6D feature vectors for the source palette (length 4).
        tgt_features: List of 6D feature vectors for the target palette (length 4).

    Returns:
        List of (src_idx, tgt_idx) pairs forming a bijection.
    """
    unmatched_tgt = list(range(len(tgt_features)))
    matches: list[tuple[int, int]] = []

    for src_idx, src_feat in enumerate(src_features):
        best_tgt_idx = min(
            unmatched_tgt,
            key=lambda ti: role_vector_distance(src_feat, tgt_features[ti]),
        )
        matches.append((src_idx, best_tgt_idx))
        unmatched_tgt.remove(best_tgt_idx)

    return matches


def average_match_distance(
    src_features: list[list[float]],
    tgt_features: list[list[float]],
    matches: list[tuple[int, int]],
) -> float:
    """Compute the average Role_Vector distance across matched color pairs.

    Args:
        src_features: Source palette 6D feature vectors.
        tgt_features: Target palette 6D feature vectors.
        matches: List of (src_idx, tgt_idx) pairs.

    Returns:
        Average Euclidean Role_Vector distance across all matched pairs.
    """
    if not matches:
        return 0.0
    total = sum(
        role_vector_distance(src_features[si], tgt_features[ti])
        for si, ti in matches
    )
    return total / len(matches)


# ─── Pair generation ──────────────────────────────────────────────────────────


def generate_pairs_for_split(
    palettes: list[dict],
    k_neighbors: int = K_NEIGHBORS,
) -> list[dict]:
    """Generate curriculum-ordered training pairs from a list of processed palettes.

    For each palette, finds its K nearest neighbors by palette centroid distance,
    then for each (palette_A, palette_B) pair generates 4 training examples
    (one per color in A matched to a color in B via greedy hue-preserving matching
    on OKLCH values).
    The resulting examples are sorted by average hue-preserving distance (similar
    hues first, diverse hue pairs later).

    Args:
        palettes: List of processed palette dicts with 'features' and 'oklch' keys.
        k_neighbors: Number of nearest-neighbor palettes to pair each palette with.

    Returns:
        List of training example dicts sorted by ascending average hue distance.
        Each example has keys: src_palette, tgt_palette, src_color, tgt_oklch.
    """
    n = len(palettes)
    k = min(k_neighbors, n - 1)

    # Collect all (pair, avg_distance) before sorting
    raw_examples: list[tuple[float, dict]] = []

    for i in range(n):
        src_palette = palettes[i]
        src_features: list[list[float]] = src_palette["features"]
        src_oklch_colors: list[list[float]] = src_palette["oklch"]

        # Find k nearest neighbors by centroid distance
        distances = []
        for j in range(n):
            if j == i:
                continue
            dist = palette_centroid_distance(src_features, palettes[j]["features"])
            distances.append((dist, j))
        distances.sort(key=lambda x: x[0])
        neighbors = [j for _, j in distances[:k]]

        for j in neighbors:
            tgt_palette = palettes[j]
            tgt_features: list[list[float]] = tgt_palette["features"]
            tgt_oklch: list[list[float]] = tgt_palette["oklch"]

            matches = match_colors_hue_preserving(src_oklch_colors, tgt_oklch)
            avg_dist = average_hue_match_distance(src_oklch_colors, tgt_oklch, matches)

            for src_idx, tgt_idx in matches:
                tgt_color_oklch = tgt_oklch[tgt_idx]
                # Normalize H to [0, 1]
                tgt_oklch_normalized = [
                    tgt_color_oklch[0],
                    tgt_color_oklch[1],
                    tgt_color_oklch[2] / 360.0,
                ]
                example = {
                    "src_palette": src_features,
                    "tgt_palette": tgt_features,
                    "src_color": src_features[src_idx],
                    "tgt_oklch": tgt_oklch_normalized,
                }
                raw_examples.append((avg_dist, example))

    # Curriculum ordering: sort by average hue-preserving distance (similar hues first)
    raw_examples.sort(key=lambda x: x[0])
    return [ex for _, ex in raw_examples]


def load_processed_palettes(path: Path) -> list[dict]:
    """Load processed palettes from a JSON file.

    Args:
        path: Path to the processed palettes JSON file.

    Returns:
        List of palette dicts with 'hex', 'oklch', and 'features' keys.
    """
    if not path.exists():
        logger.warning("Processed palettes file not found: %s", path)
        return []
    with open(path) as f:
        return json.load(f)


def generate_pairs(
    processed_dir: Path = PROCESSED_DIR,
    k_neighbors: int = K_NEIGHBORS,
) -> tuple[int, int]:
    """Run the full pair generation pipeline.

    Reads train and validation palettes, checks the total count, generates
    curriculum-ordered pairs for each split, and writes output files.

    Args:
        processed_dir: Directory containing palettes_train.json and palettes_val.json.
        k_neighbors: Number of nearest-neighbor palettes to pair each palette with.

    Returns:
        Tuple of (train_pairs_count, val_pairs_count).

    Raises:
        SystemExit: If fewer than MIN_PALETTES palettes are available in total.
    """
    train_palettes = load_processed_palettes(processed_dir / "palettes_train.json")
    val_palettes = load_processed_palettes(processed_dir / "palettes_val.json")

    total = len(train_palettes) + len(val_palettes)
    logger.info(
        "Loaded %d train + %d val = %d total palettes",
        len(train_palettes),
        len(val_palettes),
        total,
    )

    if total < MIN_PALETTES:
        logger.error(
            "Insufficient palettes: %d available, need at least %d. "
            "Run ml/scrape.py and ml/preprocess.py first.",
            total,
            MIN_PALETTES,
        )
        sys.exit(1)

    processed_dir.mkdir(parents=True, exist_ok=True)

    train_pairs = generate_pairs_for_split(train_palettes, k_neighbors=k_neighbors)
    val_pairs = generate_pairs_for_split(val_palettes, k_neighbors=k_neighbors)

    train_path = processed_dir / "pairs_train.json"
    val_path = processed_dir / "pairs_val.json"

    with open(train_path, "w") as f:
        json.dump(train_pairs, f, indent=2)
    with open(val_path, "w") as f:
        json.dump(val_pairs, f, indent=2)

    logger.info("Wrote %d training pairs to %s", len(train_pairs), train_path)
    logger.info("Wrote %d validation pairs to %s", len(val_pairs), val_path)

    return (len(train_pairs), len(val_pairs))


def main() -> None:
    """Entry point for standalone execution."""
    train_count, val_count = generate_pairs()
    logger.info(
        "Pair generation complete: %d train pairs, %d validation pairs",
        train_count,
        val_count,
    )


if __name__ == "__main__":
    main()
