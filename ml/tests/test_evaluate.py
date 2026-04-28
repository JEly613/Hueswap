"""Tests for ml/evaluate.py — property-based and unit tests.

Covers:
  - Property 12: Weighted RMSE computation (Task 8.2)
  - Unit: Baseline RMSE non-zero with hue-preserving pairs (Task 5.1)
"""

import math
import sys
from pathlib import Path

from hypothesis import given, settings
from hypothesis import strategies as st

# Ensure workspace root is on sys.path so `ml.evaluate` is importable
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ml.evaluate import per_component_rmse, weighted_rmse

# ─── Strategies ──────────────────────────────────────────────────────────────

oklch_value = st.floats(
    min_value=-1.0, max_value=2.0, allow_nan=False, allow_infinity=False
)


@st.composite
def pred_target_pairs(draw) -> tuple[list[list[float]], list[list[float]]]:
    """Generate a list of (pred, target) OKLCH triples with length 1–50."""
    n = draw(st.integers(min_value=1, max_value=50))
    preds = [[draw(oklch_value) for _ in range(3)] for _ in range(n)]
    targets = [[draw(oklch_value) for _ in range(3)] for _ in range(n)]
    return preds, targets


# ─── Property 12: Weighted RMSE computation ──────────────────────────────────
# Validates: Requirements 8.2, 8.4


@given(data=pred_target_pairs())
@settings(max_examples=100)
def test_per_component_rmse_formula(
    data: tuple[list[list[float]], list[list[float]]],
) -> None:
    """**Validates: Requirements 8.2, 8.4**

    Property 12 (part 1): For any set of prediction-target OKLCH pairs,
    per-component RMSE = sqrt(mean((pred_X - true_X)²)) for X ∈ {L, C, H}.
    """
    preds, targets = data
    n = len(preds)

    actual_L, actual_C, actual_H = per_component_rmse(preds, targets)

    # Compute expected values manually
    sum_sq_L = sum((p[0] - t[0]) ** 2 for p, t in zip(preds, targets))
    sum_sq_C = sum((p[1] - t[1]) ** 2 for p, t in zip(preds, targets))
    sum_sq_H = sum((p[2] - t[2]) ** 2 for p, t in zip(preds, targets))

    expected_L = math.sqrt(sum_sq_L / n)
    expected_C = math.sqrt(sum_sq_C / n)
    expected_H = math.sqrt(sum_sq_H / n)

    assert math.isclose(actual_L, expected_L, rel_tol=1e-6, abs_tol=1e-9), (
        f"rmse_L mismatch: actual={actual_L}, expected={expected_L}"
    )
    assert math.isclose(actual_C, expected_C, rel_tol=1e-6, abs_tol=1e-9), (
        f"rmse_C mismatch: actual={actual_C}, expected={expected_C}"
    )
    assert math.isclose(actual_H, expected_H, rel_tol=1e-6, abs_tol=1e-9), (
        f"rmse_H mismatch: actual={actual_H}, expected={expected_H}"
    )


@given(data=pred_target_pairs())
@settings(max_examples=100)
def test_weighted_rmse_formula(
    data: tuple[list[list[float]], list[list[float]]],
) -> None:
    """**Validates: Requirements 8.2, 8.4**

    Property 12 (part 2): For any set of prediction-target OKLCH pairs,
    combined weighted RMSE = sqrt(mean(2*(dL)² + (dC)² + (dH)²)).
    """
    preds, targets = data
    n = len(preds)

    actual = weighted_rmse(preds, targets)

    # Compute expected value manually
    total = sum(
        2.0 * (p[0] - t[0]) ** 2 + (p[1] - t[1]) ** 2 + (p[2] - t[2]) ** 2
        for p, t in zip(preds, targets)
    )
    expected = math.sqrt(total / n)

    assert math.isclose(actual, expected, rel_tol=1e-6, abs_tol=1e-9), (
        f"weighted_rmse mismatch: actual={actual}, expected={expected}"
    )


# ─── Unit: Baseline RMSE non-zero with hue-preserving pairs ─────────────────
# Validates: Requirements 6.1


def test_baseline_rmse_nonzero_with_hue_preserving_pairs() -> None:
    """**Validates: Requirements 6.1**

    With hue-preserving pairs, the Role_Vector baseline RMSE should be non-zero
    because the two matching strategies produce different color assignments.
    """
    from ml.evaluate import baseline_predictions, weighted_rmse
    from ml.generate_pairs import generate_pairs_for_split

    # Design palettes where Role_Vector and hue-preserving matching differ.
    #
    # Key idea: Role_Vector matches by (normalized_L, normalized_C, is_warm).
    # Hue-preserving matches by circular hue distance on OKLCH H values.
    #
    # Source palette: features [L, C, H/360, nL, nC, is_warm]
    # Color 0: hue=10°, warm, light  (nL=0.9, nC=0.5, is_warm=1)
    # Color 1: hue=120°, cool, dark  (nL=0.1, nC=0.5, is_warm=0)
    # Color 2: hue=200°, cool, light (nL=0.9, nC=0.5, is_warm=0)
    # Color 3: hue=300°, warm, dark  (nL=0.1, nC=0.5, is_warm=1)
    src_features = [
        [0.8, 0.15, 10 / 360, 0.9, 0.5, 1.0],
        [0.2, 0.15, 120 / 360, 0.1, 0.5, 0.0],
        [0.8, 0.15, 200 / 360, 0.9, 0.5, 0.0],
        [0.2, 0.15, 300 / 360, 0.1, 0.5, 1.0],
    ]
    src_oklch = [
        [0.8, 0.15, 10.0],
        [0.2, 0.15, 120.0],
        [0.8, 0.15, 200.0],
        [0.2, 0.15, 300.0],
    ]

    # Target palette: designed so hue-matching and Role_Vector matching differ.
    # Color 0: hue=15° (close to src 0 by hue), but cool, dark  (nL=0.1, nC=0.5, is_warm=0)
    # Color 1: hue=195° (close to src 2 by hue), but warm, light (nL=0.9, nC=0.5, is_warm=1)
    # Color 2: hue=125° (close to src 1 by hue), but warm, light (nL=0.9, nC=0.5, is_warm=1)
    # Color 3: hue=305° (close to src 3 by hue), but cool, dark  (nL=0.1, nC=0.5, is_warm=0)
    tgt_features = [
        [0.2, 0.15, 15 / 360, 0.1, 0.5, 0.0],
        [0.8, 0.15, 195 / 360, 0.9, 0.5, 1.0],
        [0.8, 0.15, 125 / 360, 0.9, 0.5, 1.0],
        [0.2, 0.15, 305 / 360, 0.1, 0.5, 0.0],
    ]
    tgt_oklch = [
        [0.2, 0.15, 15.0],
        [0.8, 0.15, 195.0],
        [0.8, 0.15, 125.0],
        [0.2, 0.15, 305.0],
    ]

    palettes = [
        {"features": src_features, "oklch": src_oklch},
        {"features": tgt_features, "oklch": tgt_oklch},
    ]

    # Generate pairs (uses hue-preserving matching)
    pairs = generate_pairs_for_split(palettes, k_neighbors=1)
    assert len(pairs) > 0, "Should generate at least some pairs"

    # Compute baseline predictions (uses Role_Vector matching)
    base_preds = baseline_predictions(pairs)
    targets = [p["tgt_oklch"] for p in pairs]

    # Baseline RMSE should be non-zero since matchings differ
    rmse = weighted_rmse(base_preds, targets)
    assert rmse > 0, f"Expected non-zero baseline RMSE, got {rmse}"
