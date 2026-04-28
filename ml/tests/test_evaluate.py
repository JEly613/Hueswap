"""Tests for ml/evaluate.py — property-based tests.

Covers:
  - Property 12: Weighted RMSE computation (Task 8.2)
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
