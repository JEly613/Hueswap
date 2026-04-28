"""Tests for weighted_mse_loss in ml/train_encoder.py — property-based tests.

Covers:
  - Property 10: Weighted MSE loss computation (Task 5.7)
"""

import sys
from pathlib import Path

import torch
from hypothesis import given, settings
from hypothesis import strategies as st

# Ensure workspace root is on sys.path so `ml.train_encoder` is importable
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ml.train_encoder import weighted_mse_loss

# ─── Strategies ──────────────────────────────────────────────────────────────

oklch_value_strategy = st.floats(
    min_value=-1.0, max_value=2.0, allow_nan=False, allow_infinity=False
)


@st.composite
def batch_oklch(draw) -> tuple[list[list[float]], list[list[float]]]:
    """Generate a batch of (pred, target) OKLCH pairs with batch size 1–16."""
    B = draw(st.integers(min_value=1, max_value=16))
    pred = [[draw(oklch_value_strategy) for _ in range(3)] for _ in range(B)]
    target = [[draw(oklch_value_strategy) for _ in range(3)] for _ in range(B)]
    return pred, target


# ─── Property 10: Weighted MSE loss computation ───────────────────────────────
# Validates: Requirements 5.4, 7.4, 12.1, 12.2, 12.3


@given(batch=batch_oklch())
@settings(max_examples=100)
def test_weighted_mse_loss_formula(
    batch: tuple[list[list[float]], list[list[float]]],
) -> None:
    """**Validates: Requirements 5.4, 7.4, 12.1, 12.2, 12.3**

    Property 10: For any predicted and target OKLCH values, loss equals
    mean over batch of: 2*(pred_L - true_L)² + (pred_C - true_C)² + (pred_H - true_H)²
    """
    pred_data, target_data = batch

    pred = torch.tensor(pred_data, dtype=torch.float32)    # (B, 3)
    target = torch.tensor(target_data, dtype=torch.float32)  # (B, 3)

    actual_loss = weighted_mse_loss(pred, target)

    # Compute expected loss manually
    total = 0.0
    B = len(pred_data)
    for p, t in zip(pred_data, target_data):
        pred_L, pred_C, pred_H = p
        true_L, true_C, true_H = t
        per_example = (
            2.0 * (pred_L - true_L) ** 2
            + (pred_C - true_C) ** 2
            + (pred_H - true_H) ** 2
        )
        total += per_example
    expected_loss = torch.tensor(total / B, dtype=torch.float32)

    assert torch.allclose(actual_loss, expected_loss, atol=1e-5), (
        f"Loss mismatch: actual={actual_loss.item()}, expected={expected_loss.item()}"
    )
