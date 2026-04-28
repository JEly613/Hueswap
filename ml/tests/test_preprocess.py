"""Tests for ml/preprocess.py — property-based and unit tests.

Covers:
  - Property 1: Feature vector structure and ranges (Task 2.2)
  - Property 2: Normalization maps extremes to 0 and 1 (Task 2.3)
  - Property 3: Warm/cool classification respects hue boundaries (Task 2.4)
  - Unit tests for preprocessor (Task 2.5)
"""

import json
import sys
import tempfile
from pathlib import Path

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

# Ensure workspace root is on sys.path so `ml.preprocess` is importable
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ml.preprocess import (
    compute_feature_vector,
    hex_to_oklch,
    is_warm,
    preprocess_palettes,
    process_palette,
)

# ─── Strategies ──────────────────────────────────────────────────────────────

# Valid OKLCH component ranges
L_strategy = st.floats(min_value=0.0, max_value=1.0, allow_nan=False, allow_infinity=False)
C_strategy = st.floats(min_value=0.0, max_value=0.4, allow_nan=False, allow_infinity=False)
H_strategy = st.floats(min_value=0.0, max_value=359.9999, allow_nan=False, allow_infinity=False)


@st.composite
def oklch_color(draw) -> tuple[float, float, float]:
    """Generate a valid (L, C, H) tuple."""
    return (draw(L_strategy), draw(C_strategy), draw(H_strategy))


@st.composite
def palette_of_four(draw) -> list[tuple[float, float, float]]:
    """Generate a palette of exactly 4 OKLCH colors."""
    return [draw(oklch_color()) for _ in range(4)]


@st.composite
def palette_with_nonzero_L_range(draw) -> list[tuple[float, float, float]]:
    """Generate a 4-color palette guaranteed to have non-zero lightness range."""
    # Force at least two distinct L values
    l_min = draw(st.floats(min_value=0.0, max_value=0.49, allow_nan=False, allow_infinity=False))
    l_max = draw(st.floats(min_value=l_min + 0.01, max_value=1.0, allow_nan=False, allow_infinity=False))
    # Two more L values anywhere in [0,1]
    l_mid1 = draw(L_strategy)
    l_mid2 = draw(L_strategy)
    ls = [l_min, l_max, l_mid1, l_mid2]

    colors = []
    for l in ls:
        c = draw(C_strategy)
        h = draw(H_strategy)
        colors.append((l, c, h))
    return colors


@st.composite
def palette_with_nonzero_C_range(draw) -> list[tuple[float, float, float]]:
    """Generate a 4-color palette guaranteed to have non-zero chroma range."""
    c_min = draw(st.floats(min_value=0.0, max_value=0.19, allow_nan=False, allow_infinity=False))
    c_max = draw(st.floats(min_value=c_min + 0.01, max_value=0.4, allow_nan=False, allow_infinity=False))
    c_mid1 = draw(C_strategy)
    c_mid2 = draw(C_strategy)
    cs = [c_min, c_max, c_mid1, c_mid2]

    colors = []
    for c in cs:
        l = draw(L_strategy)
        h = draw(H_strategy)
        colors.append((l, c, h))
    return colors


# ─── Property 1: Feature vector structure and ranges ─────────────────────────
# Validates: Requirements 2.2


@st.composite
def color_within_palette(draw) -> tuple[tuple[float, float, float], list[tuple[float, float, float]]]:
    """Generate a palette of 4 colors and pick one of them as the target color.

    This ensures the color's L and C are always within the palette's min/max range,
    so normalized_L and normalized_C are guaranteed to be in [0, 1].
    """
    palette = [draw(oklch_color()) for _ in range(4)]
    idx = draw(st.integers(min_value=0, max_value=3))
    color = palette[idx]
    return color, palette


@given(color_and_palette=color_within_palette())
@settings(max_examples=100)
def test_feature_vector_structure_and_ranges(
    color_and_palette: tuple[tuple[float, float, float], list[tuple[float, float, float]]],
) -> None:
    """**Validates: Requirements 2.2**

    Property 1: For any valid OKLCH color that is a member of its palette,
    the 6D feature vector has exactly 6 components with values in the correct ranges:
      L ∈ [0,1], C ∈ [0,0.4], H/360 ∈ [0,1],
      normalized_L ∈ [0,1], normalized_C ∈ [0,1], is_warm ∈ {0,1}.
    """
    color, palette = color_and_palette
    L, C, H = color
    Ls = [c[0] for c in palette]
    Cs = [c[1] for c in palette]
    min_L, max_L = min(Ls), max(Ls)
    min_C, max_C = min(Cs), max(Cs)

    fv = compute_feature_vector(L, C, H, min_L, max_L, min_C, max_C)

    assert len(fv) == 6, f"Expected 6 components, got {len(fv)}"

    feat_L, feat_C, feat_H_norm, feat_nL, feat_nC, feat_warm = fv

    assert 0.0 <= feat_L <= 1.0, f"L={feat_L} out of [0,1]"
    assert 0.0 <= feat_C <= 0.4, f"C={feat_C} out of [0,0.4]"
    assert 0.0 <= feat_H_norm <= 1.0, f"H/360={feat_H_norm} out of [0,1]"
    assert 0.0 <= feat_nL <= 1.0, f"normalized_L={feat_nL} out of [0,1]"
    assert 0.0 <= feat_nC <= 1.0, f"normalized_C={feat_nC} out of [0,1]"
    assert feat_warm in (0, 1), f"is_warm={feat_warm} not in {{0,1}}"


# ─── Property 2: Normalization maps extremes to 0 and 1 ──────────────────────
# Validates: Requirements 2.3, 2.4


@given(palette=palette_with_nonzero_L_range())
@settings(max_examples=100)
def test_normalization_lightness_extremes(palette: list[tuple[float, float, float]]) -> None:
    """**Validates: Requirements 2.3**

    Property 2 (lightness): For any palette with non-zero lightness range,
    the color with minimum L has normalized_L=0 and the color with maximum L
    has normalized_L=1.
    """
    Ls = [c[0] for c in palette]
    Cs = [c[1] for c in palette]
    min_L, max_L = min(Ls), max(Ls)
    min_C, max_C = min(Cs), max(Cs)

    assert max_L > min_L, "Palette must have non-zero L range"

    for L, C, H in palette:
        fv = compute_feature_vector(L, C, H, min_L, max_L, min_C, max_C)
        normalized_L = fv[3]

        if L == min_L:
            assert normalized_L == pytest.approx(0.0, abs=1e-9), (
                f"Min-L color should have normalized_L=0, got {normalized_L}"
            )
        if L == max_L:
            assert normalized_L == pytest.approx(1.0, abs=1e-9), (
                f"Max-L color should have normalized_L=1, got {normalized_L}"
            )


@given(palette=palette_with_nonzero_C_range())
@settings(max_examples=100)
def test_normalization_chroma_extremes(palette: list[tuple[float, float, float]]) -> None:
    """**Validates: Requirements 2.4**

    Property 2 (chroma): For any palette with non-zero chroma range,
    the color with minimum C has normalized_C=0 and the color with maximum C
    has normalized_C=1.
    """
    Ls = [c[0] for c in palette]
    Cs = [c[1] for c in palette]
    min_L, max_L = min(Ls), max(Ls)
    min_C, max_C = min(Cs), max(Cs)

    assert max_C > min_C, "Palette must have non-zero C range"

    for L, C, H in palette:
        fv = compute_feature_vector(L, C, H, min_L, max_L, min_C, max_C)
        normalized_C = fv[4]

        if C == min_C:
            assert normalized_C == pytest.approx(0.0, abs=1e-9), (
                f"Min-C color should have normalized_C=0, got {normalized_C}"
            )
        if C == max_C:
            assert normalized_C == pytest.approx(1.0, abs=1e-9), (
                f"Max-C color should have normalized_C=1, got {normalized_C}"
            )


@given(palette=palette_of_four())
@settings(max_examples=100)
def test_normalization_zero_range_returns_half(palette: list[tuple[float, float, float]]) -> None:
    """**Validates: Requirements 2.3, 2.4**

    Property 2 (zero range): When all colors in a palette have the same
    lightness or chroma, normalized value should be 0.5.
    """
    # Force zero L range by using the same L for all
    fixed_L = palette[0][0]
    fixed_C = palette[0][1]

    # Zero L range
    for _, C, H in palette:
        fv = compute_feature_vector(fixed_L, C, H, fixed_L, fixed_L, 0.0, 0.2)
        assert fv[3] == pytest.approx(0.5, abs=1e-9), (
            f"Zero L range should give normalized_L=0.5, got {fv[3]}"
        )

    # Zero C range
    for L, _, H in palette:
        fv = compute_feature_vector(L, fixed_C, H, 0.0, 1.0, fixed_C, fixed_C)
        assert fv[4] == pytest.approx(0.5, abs=1e-9), (
            f"Zero C range should give normalized_C=0.5, got {fv[4]}"
        )


# ─── Property 3: Warm/cool classification respects hue boundaries ─────────────
# Validates: Requirements 2.5, 2.6


@given(
    hue=st.floats(min_value=0.0, max_value=60.0, allow_nan=False, allow_infinity=False),
    chroma=st.floats(min_value=0.01, max_value=0.4, allow_nan=False, allow_infinity=False),
)
@settings(max_examples=100)
def test_warm_hue_low_range(hue: float, chroma: float) -> None:
    """**Validates: Requirements 2.5**

    Hue in [0°, 60°] with chroma ≥ 0.01 → is_warm=1.
    """
    result = is_warm(hue, chroma)
    assert result == 1, f"hue={hue}, chroma={chroma} should be warm, got {result}"


@given(
    hue=st.floats(min_value=330.0, max_value=359.9999, allow_nan=False, allow_infinity=False),
    chroma=st.floats(min_value=0.01, max_value=0.4, allow_nan=False, allow_infinity=False),
)
@settings(max_examples=100)
def test_warm_hue_high_range(hue: float, chroma: float) -> None:
    """**Validates: Requirements 2.5**

    Hue in [330°, 360°) with chroma ≥ 0.01 → is_warm=1.
    """
    result = is_warm(hue, chroma)
    assert result == 1, f"hue={hue}, chroma={chroma} should be warm, got {result}"


@given(
    hue=st.floats(min_value=60.01, max_value=329.99, allow_nan=False, allow_infinity=False),
    chroma=st.floats(min_value=0.01, max_value=0.4, allow_nan=False, allow_infinity=False),
)
@settings(max_examples=100)
def test_cool_hue_range(hue: float, chroma: float) -> None:
    """**Validates: Requirements 2.5**

    Hue in (60°, 330°) with chroma ≥ 0.01 → is_warm=0.
    """
    result = is_warm(hue, chroma)
    assert result == 0, f"hue={hue}, chroma={chroma} should be cool, got {result}"


@given(
    hue=st.floats(min_value=0.0, max_value=359.9999, allow_nan=False, allow_infinity=False),
    chroma=st.floats(min_value=0.0, max_value=0.0099, allow_nan=False, allow_infinity=False),
)
@settings(max_examples=100)
def test_achromatic_always_cool(hue: float, chroma: float) -> None:
    """**Validates: Requirements 2.6**

    Achromatic colors (chroma < 0.01) are always cool regardless of hue.
    """
    result = is_warm(hue, chroma)
    assert result == 0, (
        f"Achromatic color (hue={hue}, chroma={chroma}) should be cool, got {result}"
    )


# ─── Unit tests for preprocessor (Task 2.5) ──────────────────────────────────
# Validates: Requirements 2.8, 2.9


def test_process_palette_returns_none_for_invalid_hex() -> None:
    """**Validates: Requirements 2.9**

    process_palette returns None when any color has an invalid hex string.
    """
    assert process_palette(["#ff0000", "#00ff00", "#0000ff", "notahex"]) is None
    assert process_palette(["#gggggg", "#00ff00", "#0000ff", "#ffffff"]) is None
    assert process_palette(["#ff00", "#00ff00", "#0000ff", "#ffffff"]) is None
    assert process_palette(["", "#00ff00", "#0000ff", "#ffffff"]) is None


def test_process_palette_valid_returns_correct_schema() -> None:
    """**Validates: Requirements 2.8**

    process_palette returns a dict with 'hex', 'oklch', and 'features' keys
    for a valid 4-color palette.
    """
    colors = ["#ff0000", "#00ff00", "#0000ff", "#ffffff"]
    result = process_palette(colors)

    assert result is not None
    assert "hex" in result
    assert "oklch" in result
    assert "features" in result

    assert result["hex"] == colors
    assert len(result["oklch"]) == 4
    assert len(result["features"]) == 4

    for oklch in result["oklch"]:
        assert len(oklch) == 3

    for fv in result["features"]:
        assert len(fv) == 6


def test_train_val_split_disjoint_and_full_coverage() -> None:
    """**Validates: Requirements 2.8**

    preprocess_palettes produces disjoint train and val sets whose union
    covers all processed palettes.
    """
    with tempfile.TemporaryDirectory() as raw_dir_str, \
         tempfile.TemporaryDirectory() as processed_dir_str:

        raw_dir = Path(raw_dir_str)
        processed_dir = Path(processed_dir_str)

        # Write 10 valid palettes
        palettes = [
            ["#ff0000", "#00ff00", "#0000ff", "#ffffff"],
            ["#123456", "#abcdef", "#fedcba", "#654321"],
            ["#aabbcc", "#112233", "#445566", "#778899"],
            ["#ff6600", "#ffcc00", "#00ccff", "#cc00ff"],
            ["#336699", "#669933", "#993366", "#996633"],
            ["#111111", "#333333", "#666666", "#999999"],
            ["#ff9900", "#0099ff", "#99ff00", "#ff0099"],
            ["#204060", "#406080", "#6080a0", "#80a0c0"],
            ["#ffeedd", "#ddffee", "#eeddff", "#ffdde0"],
            ["#010203", "#040506", "#070809", "#0a0b0c"],
        ]
        for i, colors in enumerate(palettes):
            path = raw_dir / f"palette_{i:03d}.json"
            path.write_text(json.dumps({"colors": colors}))

        train_count, val_count = preprocess_palettes(
            raw_dir=raw_dir,
            processed_dir=processed_dir,
            train_ratio=0.8,
            seed=42,
        )

        train_path = processed_dir / "palettes_train.json"
        val_path = processed_dir / "palettes_val.json"

        assert train_path.exists()
        assert val_path.exists()

        with open(train_path) as f:
            train_data = json.load(f)
        with open(val_path) as f:
            val_data = json.load(f)

        assert len(train_data) == train_count
        assert len(val_data) == val_count
        assert train_count + val_count == len(palettes)

        # Disjoint: no hex list appears in both sets
        train_hexes = {tuple(p["hex"]) for p in train_data}
        val_hexes = {tuple(p["hex"]) for p in val_data}
        assert train_hexes.isdisjoint(val_hexes), "Train and val sets must be disjoint"


def test_output_file_format_matches_schema() -> None:
    """**Validates: Requirements 2.8**

    Output JSON files contain palettes with 'hex', 'oklch', and 'features' keys,
    each with the correct structure.
    """
    with tempfile.TemporaryDirectory() as raw_dir_str, \
         tempfile.TemporaryDirectory() as processed_dir_str:

        raw_dir = Path(raw_dir_str)
        processed_dir = Path(processed_dir_str)

        colors = ["#ff0000", "#00ff00", "#0000ff", "#ffffff"]
        (raw_dir / "palette_000.json").write_text(json.dumps({"colors": colors}))

        preprocess_palettes(raw_dir=raw_dir, processed_dir=processed_dir, train_ratio=1.0)

        train_path = processed_dir / "palettes_train.json"
        with open(train_path) as f:
            data = json.load(f)

        assert len(data) == 1
        palette = data[0]

        assert set(palette.keys()) >= {"hex", "oklch", "features"}
        assert len(palette["hex"]) == 4
        assert len(palette["oklch"]) == 4
        assert len(palette["features"]) == 4

        for fv in palette["features"]:
            assert len(fv) == 6
            L, C, H_norm, nL, nC, warm = fv
            assert -1e-9 <= L <= 1.0 + 1e-9
            assert -1e-9 <= C <= 0.4 + 1e-9
            assert -1e-9 <= H_norm <= 1.0 + 1e-9
            assert -1e-9 <= nL <= 1.0 + 1e-9
            assert -1e-9 <= nC <= 1.0 + 1e-9
            assert warm in (0, 1)
