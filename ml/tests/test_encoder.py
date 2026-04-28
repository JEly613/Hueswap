"""Tests for ml/encoder.py — property-based tests.

Covers:
  - Property 6: Encoder forward preserves tensor shape (Task 5.3)
  - Property 7: Encoder encode preserves tensor shape (Task 5.4)
  - Property 8: Encoder permutation invariance (Task 5.5)
"""

import itertools
import sys
from pathlib import Path

import torch
from hypothesis import given, settings
from hypothesis import strategies as st

# Ensure workspace root is on sys.path so `ml.encoder` is importable
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ml.encoder import PaletteEncoder

# ─── Strategies ──────────────────────────────────────────────────────────────

batch_size_strategy = st.integers(min_value=1, max_value=16)

feature_value_strategy = st.floats(
    min_value=-1.0, max_value=2.0, allow_nan=False, allow_infinity=False
)


@st.composite
def forward_input(draw) -> tuple[int, list]:
    """Generate (batch_size, input_data) for forward() — shape (B, 3, 6)."""
    B = draw(batch_size_strategy)
    data = [
        [[draw(feature_value_strategy) for _ in range(6)] for _ in range(3)]
        for _ in range(B)
    ]
    return B, data


@st.composite
def encode_input(draw) -> tuple[int, list]:
    """Generate (batch_size, input_data) for encode() — shape (B, 4, 6)."""
    B = draw(batch_size_strategy)
    data = [
        [[draw(feature_value_strategy) for _ in range(6)] for _ in range(4)]
        for _ in range(B)
    ]
    return B, data


@st.composite
def palette_input(draw) -> list:
    """Generate a single 4-color palette as (1, 4, 6) data."""
    data = [
        [[draw(feature_value_strategy) for _ in range(6)] for _ in range(4)]
    ]
    return data


# ─── Property 6: Encoder forward preserves tensor shape ──────────────────────
# Validates: Requirements 4.1, 4.2


@given(inp=forward_input())
@settings(max_examples=100)
def test_encoder_forward_preserves_shape(inp: tuple[int, list]) -> None:
    """**Validates: Requirements 4.1, 4.2**

    Property 6: For any batch size B (1–16) and random (B, 3, 6) input,
    forward() produces (B, 3) output.
    """
    B, data = inp
    model = PaletteEncoder()
    model.eval()

    x = torch.tensor(data, dtype=torch.float32)  # (B, 3, 6)
    assert x.shape == (B, 3, 6)

    with torch.no_grad():
        out = model(x)

    assert out.shape == (B, 3), f"Expected ({B}, 3), got {tuple(out.shape)}"


# ─── Property 7: Encoder encode preserves tensor shape ───────────────────────
# Validates: Requirements 4.3, 4.4


@given(inp=encode_input())
@settings(max_examples=100)
def test_encoder_encode_preserves_shape(inp: tuple[int, list]) -> None:
    """**Validates: Requirements 4.3, 4.4**

    Property 7: For any batch size B (1–16) and random (B, 4, 6) input,
    encode() produces (B, 64) output.
    """
    B, data = inp
    model = PaletteEncoder()
    model.eval()

    x = torch.tensor(data, dtype=torch.float32)  # (B, 4, 6)
    assert x.shape == (B, 4, 6)

    with torch.no_grad():
        out = model.encode(x)

    assert out.shape == (B, 64), f"Expected ({B}, 64), got {tuple(out.shape)}"


# ─── Property 8: Encoder permutation invariance ───────────────────────────────
# Validates: Requirements 4.7


@given(palette=palette_input())
@settings(max_examples=100)
def test_encoder_permutation_invariance(palette: list) -> None:
    """**Validates: Requirements 4.7**

    Property 8: For any 4-color palette (1, 4, 6), any permutation of the
    4 colors produces the same embedding within 1e-5 tolerance.
    """
    model = PaletteEncoder()
    model.eval()

    x = torch.tensor(palette, dtype=torch.float32)  # (1, 4, 6)
    assert x.shape == (1, 4, 6)

    with torch.no_grad():
        base_embedding = model.encode(x)  # (1, 64)

    # Test all 24 permutations of the 4 colors
    for perm in itertools.permutations(range(4)):
        x_perm = x[:, list(perm), :]  # (1, 4, 6) with reordered colors
        with torch.no_grad():
            perm_embedding = model.encode(x_perm)  # (1, 64)

        assert torch.allclose(base_embedding, perm_embedding, atol=1e-5), (
            f"Permutation {perm} produced different embedding. "
            f"Max diff: {(base_embedding - perm_embedding).abs().max().item()}"
        )
