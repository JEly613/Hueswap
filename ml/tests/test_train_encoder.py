"""Tests for ml/train_encoder.py — property-based tests.

Covers:
  - Property 9: Masked example generation covers all positions (Task 5.6)
"""

import sys
from pathlib import Path

from hypothesis import given, settings
from hypothesis import strategies as st

# Ensure workspace root is on sys.path so `ml.train_encoder` is importable
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ml.train_encoder import generate_masked_examples

# ─── Strategies ──────────────────────────────────────────────────────────────

feature_value_strategy = st.floats(
    min_value=0.0, max_value=1.0, allow_nan=False, allow_infinity=False
)


@st.composite
def palette_features(draw) -> list[list[float]]:
    """Generate a valid 4-color palette as a list of 4 six-dimensional feature vectors."""
    return [
        [draw(feature_value_strategy) for _ in range(6)]
        for _ in range(4)
    ]


# ─── Property 9: Masked example generation covers all positions ──────────────
# Validates: Requirements 5.2, 5.3


@given(palette=palette_features())
@settings(max_examples=100)
def test_generate_masked_examples_covers_all_positions(
    palette: list[list[float]],
) -> None:
    """**Validates: Requirements 5.2, 5.3**

    Property 9: For any 4-color palette, generate_masked_examples produces
    exactly 4 examples, each masking a different position. The input is
    (3, 6) visible colors and the target is the masked color's [L, C, H/360].
    """
    examples = generate_masked_examples(palette)

    # Exactly 4 examples
    assert len(examples) == 4, f"Expected 4 examples, got {len(examples)}"

    # generate_masked_examples masks position i for the i-th example
    for i, (visible, target) in enumerate(examples):
        # Input: exactly 3 visible colors, each with 6 features
        assert len(visible) == 3, (
            f"Example {i}: expected 3 visible colors, got {len(visible)}"
        )
        for fv in visible:
            assert len(fv) == 6, (
                f"Example {i}: visible feature vector has {len(fv)} dims, expected 6"
            )

        # Target: [L, C, H/360] — 3 values
        assert len(target) == 3, (
            f"Example {i}: expected target of length 3, got {len(target)}"
        )

        # Position i is masked: target must be palette[i][:3]
        expected_target = palette[i][:3]
        assert target == expected_target, (
            f"Example {i}: target {target} does not match "
            f"masked color's [L, C, H/360] {expected_target}"
        )

        # Visible colors are the 3 remaining colors (all except position i), in order
        expected_visible = [palette[j] for j in range(4) if j != i]
        assert visible == expected_visible, (
            f"Example {i}: visible colors {visible} do not match "
            f"expected {expected_visible}"
        )

    # All 4 positions are covered (one per example)
    assert len(examples) == 4, "Must produce exactly 4 examples covering all positions"
