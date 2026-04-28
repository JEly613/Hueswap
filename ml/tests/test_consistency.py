"""Property test: Cross-language feature vector consistency (Property 14).

Verifies that Python's compute_feature_vector() produces results matching
the TypeScript computeFeatureVector() formula within floating-point tolerance.

Validates: Requirements 11.1, 11.2, 11.3, 11.4
"""

import sys
from pathlib import Path

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

# Ensure workspace root is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ml.preprocess import (
    compute_feature_vector,
    hex_to_oklch,
    is_warm,
)

TOLERANCE = 1e-6
ACHROMATIC_THRESHOLD = 0.01

# ─── Strategies ──────────────────────────────────────────────────────────────

# Hex byte: 00–ff
hex_byte = st.integers(min_value=0, max_value=255).map(lambda n: f"{n:02x}")

@st.composite
def hex_color(draw) -> str:
    """Generate a random valid 6-digit hex color string."""
    r = draw(hex_byte)
    g = draw(hex_byte)
    b = draw(hex_byte)
    return f"#{r}{g}{b}"


@st.composite
def palette_of_four_hex(draw) -> list[str]:
    """Generate a palette of exactly 4 random hex colors."""
    return [draw(hex_color()) for _ in range(4)]


# ─── Reference implementation (mirrors TypeScript exactly) ───────────────────

def ts_compute_feature_vector(
    L: float, C: float, H: float,
    min_L: float, max_L: float,
    min_C: float, max_C: float,
) -> list[float]:
    """Reference implementation matching TypeScript computeFeatureVector().

    TypeScript formula (lib/color-math.ts):
      [L, C, H/360, normalized_L, normalized_C, is_warm]

    Normalization:
      normalized_L = (L - minL) / (maxL - minL)  if range > 0 else 0.5
      normalized_C = (C - minC) / (maxC - minC)  if range > 0 else 0.5

    isWarm (lib/color-math.ts):
      if chroma < 0.01 → false (cool)
      h = ((H % 360) + 360) % 360
      warm if h <= 60 or h >= 330
    """
    range_L = max_L - min_L
    range_C = max_C - min_C

    normalized_L = (L - min_L) / range_L if range_L > 0 else 0.5
    normalized_C = (C - min_C) / range_C if range_C > 0 else 0.5

    # TypeScript isWarm: achromatic threshold is 0.01
    if C < ACHROMATIC_THRESHOLD:
        warm = 0
    else:
        h = ((H % 360) + 360) % 360
        warm = 1 if (h <= 60 or h >= 330) else 0

    return [L, C, H / 360.0, normalized_L, normalized_C, warm]


# ─── Property 14: Cross-language feature vector consistency ───────────────────
# Validates: Requirements 11.1, 11.2, 11.3, 11.4


@given(color=hex_color(), palette=palette_of_four_hex())
@settings(max_examples=100)
def test_feature_vector_matches_typescript_formula(
    color: str, palette: list[str]
) -> None:
    """**Validates: Requirements 11.1, 11.2, 11.3, 11.4**

    Property 14: For any valid hex color and palette, Python's
    compute_feature_vector() matches the TypeScript computeFeatureVector()
    formula within 1e-6 tolerance.

    Tests the full pipeline: hex → OKLCH → feature vector.
    """
    # Convert color to OKLCH
    oklch = hex_to_oklch(color)
    assert oklch is not None, f"hex_to_oklch failed for {color}"
    L, C, H = oklch

    # Convert palette to OKLCH and compute ranges
    palette_oklch = []
    for hex_c in palette:
        result = hex_to_oklch(hex_c)
        assert result is not None, f"hex_to_oklch failed for {hex_c}"
        palette_oklch.append(result)

    Ls = [c[0] for c in palette_oklch]
    Cs = [c[1] for c in palette_oklch]
    min_L, max_L = min(Ls), max(Ls)
    min_C, max_C = min(Cs), max(Cs)

    # Python implementation
    py_fv = compute_feature_vector(L, C, H, min_L, max_L, min_C, max_C)

    # TypeScript reference
    ts_fv = ts_compute_feature_vector(L, C, H, min_L, max_L, min_C, max_C)

    assert len(py_fv) == 6, f"Expected 6 components, got {len(py_fv)}"
    assert len(ts_fv) == 6

    for i, (py_val, ts_val) in enumerate(zip(py_fv, ts_fv)):
        assert abs(py_val - ts_val) <= TOLERANCE, (
            f"Component {i} mismatch for color={color}, palette={palette}: "
            f"Python={py_val}, TypeScript={ts_val}, diff={abs(py_val - ts_val)}"
        )


@given(
    hue=st.floats(min_value=0.0, max_value=359.9999, allow_nan=False, allow_infinity=False),
    chroma=st.floats(min_value=0.0, max_value=0.0099, allow_nan=False, allow_infinity=False),
)
@settings(max_examples=100)
def test_achromatic_threshold_matches_typescript(hue: float, chroma: float) -> None:
    """**Validates: Requirements 11.3**

    Achromatic threshold: chroma < 0.01 → is_warm = 0, matching TypeScript.
    """
    result = is_warm(hue, chroma)
    assert result == 0, (
        f"Achromatic color (hue={hue}, chroma={chroma}) should be cool (0), got {result}"
    )


@given(
    hue=st.floats(min_value=0.0, max_value=60.0, allow_nan=False, allow_infinity=False),
    chroma=st.floats(min_value=0.01, max_value=0.4, allow_nan=False, allow_infinity=False),
)
@settings(max_examples=100)
def test_warm_low_hue_boundary_matches_typescript(hue: float, chroma: float) -> None:
    """**Validates: Requirements 11.2**

    Warm boundary [0°, 60°]: is_warm = 1, matching TypeScript isWarm().
    """
    result = is_warm(hue, chroma)
    assert result == 1, (
        f"hue={hue} in [0,60] with chroma={chroma} should be warm (1), got {result}"
    )


@given(
    hue=st.floats(min_value=330.0, max_value=359.9999, allow_nan=False, allow_infinity=False),
    chroma=st.floats(min_value=0.01, max_value=0.4, allow_nan=False, allow_infinity=False),
)
@settings(max_examples=100)
def test_warm_high_hue_boundary_matches_typescript(hue: float, chroma: float) -> None:
    """**Validates: Requirements 11.2**

    Warm boundary [330°, 360°): is_warm = 1, matching TypeScript isWarm().
    """
    result = is_warm(hue, chroma)
    assert result == 1, (
        f"hue={hue} in [330,360) with chroma={chroma} should be warm (1), got {result}"
    )


@given(
    hue=st.floats(min_value=60.01, max_value=329.99, allow_nan=False, allow_infinity=False),
    chroma=st.floats(min_value=0.01, max_value=0.4, allow_nan=False, allow_infinity=False),
)
@settings(max_examples=100)
def test_cool_hue_range_matches_typescript(hue: float, chroma: float) -> None:
    """**Validates: Requirements 11.2**

    Cool range (60°, 330°): is_warm = 0, matching TypeScript isWarm().
    """
    result = is_warm(hue, chroma)
    assert result == 0, (
        f"hue={hue} in (60,330) with chroma={chroma} should be cool (0), got {result}"
    )


@given(
    hue=st.floats(min_value=0.0, max_value=359.9999, allow_nan=False, allow_infinity=False),
    chroma=st.floats(min_value=0.0, max_value=0.4, allow_nan=False, allow_infinity=False),
)
@settings(max_examples=100)
def test_h_over_360_normalization(hue: float, chroma: float) -> None:
    """**Validates: Requirements 11.1**

    H/360 normalization: feature vector index 2 equals H/360, in [0, 1].
    Matches TypeScript: color.h / 360.
    """
    # Use a simple palette with known ranges
    fv = compute_feature_vector(0.5, chroma, hue, 0.0, 1.0, 0.0, 0.4)
    h_norm = fv[2]
    expected = hue / 360.0
    assert abs(h_norm - expected) <= TOLERANCE, (
        f"H/360 normalization mismatch: hue={hue}, got {h_norm}, expected {expected}"
    )
    assert 0.0 <= h_norm <= 1.0, f"H/360={h_norm} out of [0,1]"


@given(
    L=st.floats(min_value=0.0, max_value=1.0, allow_nan=False, allow_infinity=False),
    C=st.floats(min_value=0.0, max_value=0.4, allow_nan=False, allow_infinity=False),
    H=st.floats(min_value=0.0, max_value=359.9999, allow_nan=False, allow_infinity=False),
)
@settings(max_examples=100)
def test_zero_range_normalization_returns_half(L: float, C: float, H: float) -> None:
    """**Validates: Requirements 11.1**

    Zero-range normalization → 0.5, matching TypeScript normalizeColor().
    When palette has zero L or C range, normalized value is 0.5.
    """
    # Zero L range
    fv_zero_L = compute_feature_vector(L, C, H, L, L, 0.0, 0.2)
    assert abs(fv_zero_L[3] - 0.5) <= TOLERANCE, (
        f"Zero L range should give normalized_L=0.5, got {fv_zero_L[3]}"
    )

    # Zero C range
    fv_zero_C = compute_feature_vector(L, C, H, 0.0, 1.0, C, C)
    assert abs(fv_zero_C[4] - 0.5) <= TOLERANCE, (
        f"Zero C range should give normalized_C=0.5, got {fv_zero_C[4]}"
    )
