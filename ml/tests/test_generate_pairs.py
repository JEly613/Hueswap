"""Tests for ml/generate_pairs.py — property-based and unit tests.

Covers:
  - Property 4: Role_Vector matching produces valid bijection (Task 3.2)
  - Property 5: Curriculum ordering is monotonically non-decreasing (Task 3.3)
  - Unit tests for pair generator (Task 3.4)
"""

import json
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

# Ensure workspace root is on sys.path so `ml.generate_pairs` is importable
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ml.generate_pairs import (
    average_hue_match_distance,
    average_match_distance,
    circular_hue_distance,
    generate_pairs,
    generate_pairs_for_split,
    hue_preserving_distance,
    match_colors_greedy,
    match_colors_hue_preserving,
)

# ─── Strategies ──────────────────────────────────────────────────────────────

# Valid 6D feature vector component ranges
L_strategy = st.floats(min_value=0.0, max_value=1.0, allow_nan=False, allow_infinity=False)
C_strategy = st.floats(min_value=0.0, max_value=0.4, allow_nan=False, allow_infinity=False)
H_norm_strategy = st.floats(min_value=0.0, max_value=1.0, allow_nan=False, allow_infinity=False)
norm_strategy = st.floats(min_value=0.0, max_value=1.0, allow_nan=False, allow_infinity=False)
warm_strategy = st.integers(min_value=0, max_value=1)
hue_strategy = st.floats(min_value=0.0, max_value=359.999, allow_nan=False, allow_infinity=False)


@st.composite
def feature_vector(draw) -> list[float]:
    """Generate a valid 6D feature vector [L, C, H/360, nL, nC, is_warm]."""
    return [
        draw(L_strategy),
        draw(C_strategy),
        draw(H_norm_strategy),
        draw(norm_strategy),
        draw(norm_strategy),
        float(draw(warm_strategy)),
    ]


@st.composite
def palette_features(draw) -> list[list[float]]:
    """Generate a palette of exactly 4 6D feature vectors."""
    return [draw(feature_vector()) for _ in range(4)]


@st.composite
def two_distinct_palettes(draw) -> tuple[list[list[float]], list[list[float]]]:
    """Generate two distinct 4-color palettes."""
    src = draw(palette_features())
    tgt = draw(palette_features())
    return src, tgt


@st.composite
def palette_dict(draw) -> dict:
    """Generate a processed palette dict with 'features' and 'oklch' keys."""
    features = draw(palette_features())
    # oklch: [L, C, H] where H is in [0, 360]
    oklch = [
        [
            draw(L_strategy),
            draw(C_strategy),
            draw(st.floats(min_value=0.0, max_value=360.0, allow_nan=False, allow_infinity=False)),
        ]
        for _ in range(4)
    ]
    return {"features": features, "oklch": oklch}


@st.composite
def palette_collection(draw) -> list[dict]:
    """Generate a collection of 3–10 processed palette dicts."""
    n = draw(st.integers(min_value=3, max_value=10))
    return [draw(palette_dict()) for _ in range(n)]


# ─── Property 1: Circular hue distance is symmetric and bounded [0, 180] ─────
# Validates: Requirements 1.2, 1.3, 7.1


@given(h1=hue_strategy, h2=hue_strategy)
@settings(max_examples=100)
def test_circular_hue_distance_symmetric_and_bounded(h1: float, h2: float) -> None:
    """**Validates: Requirements 1.2, 1.3, 7.1**

    Property 1: circular_hue_distance is symmetric and bounded [0, 180].
    """
    d1 = circular_hue_distance(h1, h2)
    d2 = circular_hue_distance(h2, h1)
    assert d1 == d2, f"Not symmetric: d({h1},{h2})={d1} != d({h2},{h1})={d2}"
    assert 0 <= d1 <= 180, f"Out of bounds: d({h1},{h2})={d1}"


# ─── Property 2: Circular hue distance wraps correctly at 360° ───────────────
# Validates: Requirements 1.4, 7.2

offset_strategy = st.floats(min_value=0.0, max_value=180.0, allow_nan=False, allow_infinity=False)

@given(h=hue_strategy, d=offset_strategy)
@settings(max_examples=100)
def test_circular_hue_distance_wraps_at_360(h: float, d: float) -> None:
    """**Validates: Requirements 1.4, 7.2**

    Property 2: For any hue h and offset d ∈ [0, 180],
    circular_hue_distance(h, (h + d) % 360) ≈ d.
    """
    h2 = (h + d) % 360.0
    result = circular_hue_distance(h, h2)
    assert abs(result - d) < 1e-9, f"Expected ≈{d}, got {result} for h={h}, d={d}"


# ─── Property 3: Hue-preserving matching produces valid bijection ─────────────
# Validates: Requirements 3.2, 7.3


@st.composite
def oklch_palette(draw) -> list[list[float]]:
    """Generate a 4-color OKLCH palette with valid [L, C, H] triples."""
    return [
        [
            draw(L_strategy),
            draw(C_strategy),
            draw(st.floats(min_value=0.0, max_value=359.999, allow_nan=False, allow_infinity=False)),
        ]
        for _ in range(4)
    ]


@given(src=oklch_palette(), tgt=oklch_palette())
@settings(max_examples=100)
def test_hue_preserving_matching_bijection(src: list[list[float]], tgt: list[list[float]]) -> None:
    """**Validates: Requirements 3.2, 7.3**

    Property 3: For any two 4-color OKLCH palettes, match_colors_hue_preserving
    produces exactly 4 pairs forming a bijection.
    """
    matches = match_colors_hue_preserving(src, tgt)
    assert len(matches) == 4
    src_indices = [si for si, _ in matches]
    tgt_indices = [ti for _, ti in matches]
    assert set(src_indices) == {0, 1, 2, 3}
    assert set(tgt_indices) == {0, 1, 2, 3}
    assert len(set(src_indices)) == 4
    assert len(set(tgt_indices)) == 4


# ─── Property 4a: Achromatic fallback uses lightness distance ─────────────────
# Validates: Requirements 2.3, 7.4

achromatic_chroma = st.floats(min_value=0.0, max_value=0.0099, allow_nan=False, allow_infinity=False)

@given(
    L1=L_strategy, L2=L_strategy,
    C1=achromatic_chroma, C2=C_strategy,
    H1=hue_strategy, H2=hue_strategy,
)
@settings(max_examples=100)
def test_achromatic_fallback_uses_lightness(
    L1: float, L2: float, C1: float, C2: float, H1: float, H2: float,
) -> None:
    """**Validates: Requirements 2.3, 7.4**

    Property 4a: When at least one color is achromatic (chroma < 0.01),
    hue_preserving_distance returns |L1 - L2| * 180.
    """
    src = [L1, C1, H1]
    tgt = [L2, C2, H2]
    result = hue_preserving_distance(src, tgt)
    expected = abs(L1 - L2) * 180.0
    assert abs(result - expected) < 1e-9, f"Expected {expected}, got {result}"


# ─── Property 6: Hue-preserving distance is non-negative and symmetric ───────
# Validates: Requirements 2.4, 2.5, 7.6


@st.composite
def oklch_color(draw) -> list[float]:
    """Generate a single valid OKLCH color [L, C, H]."""
    return [
        draw(L_strategy),
        draw(C_strategy),
        draw(st.floats(min_value=0.0, max_value=359.999, allow_nan=False, allow_infinity=False)),
    ]


@given(a=oklch_color(), b=oklch_color())
@settings(max_examples=100)
def test_hue_preserving_distance_nonnegative_and_symmetric(
    a: list[float], b: list[float],
) -> None:
    """**Validates: Requirements 2.4, 2.5, 7.6**

    Property 6: hue_preserving_distance is non-negative and symmetric.
    """
    d_ab = hue_preserving_distance(a, b)
    d_ba = hue_preserving_distance(b, a)
    assert d_ab >= 0, f"Negative distance: {d_ab}"
    assert d_ab == d_ba, f"Not symmetric: d(a,b)={d_ab} != d(b,a)={d_ba}"


# ─── Property 4: Role_Vector matching produces valid bijection ────────────────
# Validates: Requirements 3.2


@given(palettes=two_distinct_palettes())
@settings(max_examples=100)
def test_match_colors_greedy_bijection(
    palettes: tuple[list[list[float]], list[list[float]]],
) -> None:
    """**Validates: Requirements 3.2**

    Property 4: For any two distinct 4-color palettes, match_colors_greedy
    produces exactly 4 pairs forming a bijection — each source index appears
    exactly once and each target index appears exactly once.
    """
    src_features, tgt_features = palettes
    matches = match_colors_greedy(src_features, tgt_features)

    # Exactly 4 pairs
    assert len(matches) == 4, f"Expected 4 pairs, got {len(matches)}"

    src_indices = [si for si, _ in matches]
    tgt_indices = [ti for _, ti in matches]

    # Source indices form a bijection over {0, 1, 2, 3}
    assert set(src_indices) == {0, 1, 2, 3}, (
        f"Source indices {src_indices} do not cover {{0,1,2,3}}"
    )
    assert len(src_indices) == len(set(src_indices)), (
        f"Duplicate source indices in {src_indices}"
    )

    # Target indices form a bijection over {0, 1, 2, 3}
    assert set(tgt_indices) == {0, 1, 2, 3}, (
        f"Target indices {tgt_indices} do not cover {{0,1,2,3}}"
    )
    assert len(tgt_indices) == len(set(tgt_indices)), (
        f"Duplicate target indices in {tgt_indices}"
    )


# ─── Property 5: Curriculum ordering is monotonically non-decreasing ─────────
# Validates: Requirements 3.4


@given(palettes=palette_collection())
@settings(max_examples=100)
def test_curriculum_ordering_monotonically_nondecreasing(palettes: list[dict]) -> None:
    """**Validates: Requirements 4.4, 7.5**

    Property 5: For any sequence of generated pairs from generate_pairs_for_split,
    the average hue-preserving distance is monotonically non-decreasing (similar
    hues appear before diverse hue pairs).
    """
    # Deduplicate palettes by features to ensure unambiguous features→oklch lookup
    seen_features: set[tuple[tuple[float, ...], ...]] = set()
    unique_palettes: list[dict] = []
    for p in palettes:
        key = tuple(tuple(f) for f in p["features"])
        if key not in seen_features:
            seen_features.add(key)
            unique_palettes.append(p)

    if len(unique_palettes) < 3:
        return  # Need at least 3 palettes for meaningful pairs

    examples = generate_pairs_for_split(unique_palettes, k_neighbors=min(3, len(unique_palettes) - 1))

    if len(examples) < 2:
        return  # Nothing to compare

    # Build lookup: tuple of features → oklch (now guaranteed unique)
    features_to_oklch: dict[tuple[tuple[float, ...], ...], list[list[float]]] = {}
    for p in unique_palettes:
        key = tuple(tuple(f) for f in p["features"])
        features_to_oklch[key] = p["oklch"]

    # Recompute avg hue distance for each example and verify non-decreasing order
    avg_distances = []
    for ex in examples:
        src_key = tuple(tuple(f) for f in ex["src_palette"])
        tgt_key = tuple(tuple(f) for f in ex["tgt_palette"])
        src_oklch = features_to_oklch[src_key]
        tgt_oklch = features_to_oklch[tgt_key]
        matches = match_colors_hue_preserving(src_oklch, tgt_oklch)
        avg_dist = average_hue_match_distance(src_oklch, tgt_oklch, matches)
        avg_distances.append(avg_dist)

    for i in range(len(avg_distances) - 1):
        assert avg_distances[i] <= avg_distances[i + 1] + 1e-9, (
            f"Curriculum ordering violated at index {i}: "
            f"avg_dist[{i}]={avg_distances[i]} > avg_dist[{i+1}]={avg_distances[i+1]}"
        )


# ─── Unit tests for pair generator (Task 3.4) ─────────────────────────────────
# Validates: Requirements 3.6


def _make_palette_dict(seed: int = 0) -> dict:
    """Create a minimal valid processed palette dict for testing."""
    import math
    # Deterministic feature vectors based on seed
    features = [
        [
            (seed * 4 + i) / 20.0 % 1.0,
            (seed * 4 + i) / 50.0 % 0.4,
            (seed * 4 + i) / 40.0 % 1.0,
            (seed * 4 + i) / 30.0 % 1.0,
            (seed * 4 + i) / 35.0 % 1.0,
            float((seed + i) % 2),
        ]
        for i in range(4)
    ]
    oklch = [
        [
            (seed * 4 + i) / 20.0 % 1.0,
            (seed * 4 + i) / 50.0 % 0.4,
            ((seed * 4 + i) * 30) % 360.0,
        ]
        for i in range(4)
    ]
    return {"features": features, "oklch": oklch}


def test_generate_pairs_exits_when_insufficient_palettes(tmp_path: Path) -> None:
    """**Validates: Requirements 3.6**

    When total palettes < 100, generate_pairs calls sys.exit(1).
    """
    processed_dir = tmp_path / "processed"
    processed_dir.mkdir()

    # Write fewer than 100 palettes total (50 train + 10 val = 60 total)
    train_palettes = [_make_palette_dict(i) for i in range(50)]
    val_palettes = [_make_palette_dict(i + 50) for i in range(10)]

    (processed_dir / "palettes_train.json").write_text(json.dumps(train_palettes))
    (processed_dir / "palettes_val.json").write_text(json.dumps(val_palettes))

    with pytest.raises(SystemExit) as exc_info:
        generate_pairs(processed_dir=processed_dir)

    assert exc_info.value.code == 1


def test_generate_pairs_output_format_matches_schema(tmp_path: Path) -> None:
    """**Validates: Requirements 3.6**

    Each generated pair has src_palette, tgt_palette, src_color, tgt_oklch keys
    with correct shapes.
    """
    processed_dir = tmp_path / "processed"
    processed_dir.mkdir()

    # Write exactly 100 palettes (80 train + 20 val)
    train_palettes = [_make_palette_dict(i) for i in range(80)]
    val_palettes = [_make_palette_dict(i + 80) for i in range(20)]

    (processed_dir / "palettes_train.json").write_text(json.dumps(train_palettes))
    (processed_dir / "palettes_val.json").write_text(json.dumps(val_palettes))

    train_count, val_count = generate_pairs(processed_dir=processed_dir, k_neighbors=2)

    # Verify output files exist
    train_path = processed_dir / "pairs_train.json"
    val_path = processed_dir / "pairs_val.json"
    assert train_path.exists(), "pairs_train.json should be created"
    assert val_path.exists(), "pairs_val.json should be created"

    with open(train_path) as f:
        train_pairs = json.load(f)
    with open(val_path) as f:
        val_pairs = json.load(f)

    assert len(train_pairs) == train_count
    assert len(val_pairs) == val_count
    assert train_count > 0, "Should produce at least some training pairs"

    # Validate schema for each example
    for pair in train_pairs:
        assert "src_palette" in pair, "Missing src_palette key"
        assert "tgt_palette" in pair, "Missing tgt_palette key"
        assert "src_color" in pair, "Missing src_color key"
        assert "tgt_oklch" in pair, "Missing tgt_oklch key"

        # src_palette: list of 4 feature vectors of length 6
        assert len(pair["src_palette"]) == 4, (
            f"src_palette should have 4 colors, got {len(pair['src_palette'])}"
        )
        for fv in pair["src_palette"]:
            assert len(fv) == 6, f"src_palette feature vector should have 6 dims, got {len(fv)}"

        # tgt_palette: list of 4 feature vectors of length 6
        assert len(pair["tgt_palette"]) == 4, (
            f"tgt_palette should have 4 colors, got {len(pair['tgt_palette'])}"
        )
        for fv in pair["tgt_palette"]:
            assert len(fv) == 6, f"tgt_palette feature vector should have 6 dims, got {len(fv)}"

        # src_color: single feature vector of length 6
        assert len(pair["src_color"]) == 6, (
            f"src_color should have 6 dims, got {len(pair['src_color'])}"
        )

        # tgt_oklch: [L, C, H/360] — 3 values
        assert len(pair["tgt_oklch"]) == 3, (
            f"tgt_oklch should have 3 values, got {len(pair['tgt_oklch'])}"
        )


# ─── Unit tests for known hue distance examples (Task 4.1) ───────────────────
# Validates: Requirements 1.4, 7.7


def test_circular_hue_distance_wrapping_example() -> None:
    """distance(10°, 350°) == 20° (wraps around 360°)."""
    assert circular_hue_distance(10.0, 350.0) == 20.0


def test_circular_hue_distance_maximum_example() -> None:
    """distance(90°, 270°) == 180° (maximum distance)."""
    assert circular_hue_distance(90.0, 270.0) == 180.0


def test_circular_hue_distance_identity_example() -> None:
    """distance(45°, 45°) == 0° (identical hues)."""
    assert circular_hue_distance(45.0, 45.0) == 0.0


def test_achromatic_pair_uses_lightness() -> None:
    """Achromatic pair: distance based on lightness difference × 180."""
    # Both achromatic (chroma < 0.01)
    src = [0.3, 0.005, 0.0]
    tgt = [0.7, 0.008, 90.0]
    result = hue_preserving_distance(src, tgt)
    expected = abs(0.3 - 0.7) * 180.0  # 72.0
    assert abs(result - expected) < 1e-9, f"Expected {expected}, got {result}"
