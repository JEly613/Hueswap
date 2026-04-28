"""Tests for ml/mapper.py and ml/train_mapper.py.

Covers:
  - Property 11: Mapper preserves tensor shape (Task 6.3)
  - Unit tests for mapper training helpers (Task 6.4)
"""

import sys
import tempfile
from pathlib import Path

import torch
from hypothesis import given, settings
from hypothesis import strategies as st

# Ensure workspace root is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ml.encoder import PaletteEncoder
from ml.mapper import ColorMapper
from ml.train_mapper import load_frozen_encoder

# ─── Strategies ──────────────────────────────────────────────────────────────

batch_size_strategy = st.integers(min_value=1, max_value=16)

feature_value_strategy = st.floats(
    min_value=-1.0, max_value=2.0, allow_nan=False, allow_infinity=False
)


@st.composite
def mapper_input(draw) -> tuple[int, list, list, list]:
    """Generate (B, src_embed, tgt_embed, src_features) for ColorMapper.forward()."""
    B = draw(batch_size_strategy)
    src_embed = [[draw(feature_value_strategy) for _ in range(64)] for _ in range(B)]
    tgt_embed = [[draw(feature_value_strategy) for _ in range(64)] for _ in range(B)]
    src_features = [[draw(feature_value_strategy) for _ in range(6)] for _ in range(B)]
    return B, src_embed, tgt_embed, src_features


# ─── Property 11: Mapper preserves tensor shape ───────────────────────────────
# Validates: Requirements 6.1, 6.4


@given(inp=mapper_input())
@settings(max_examples=100)
def test_mapper_preserves_shape(
    inp: tuple[int, list, list, list],
) -> None:
    """**Validates: Requirements 6.1, 6.4**

    Property 11: For any batch size B (1–16), source embedding (B, 64),
    target embedding (B, 64), and source features (B, 6), ColorMapper.forward()
    produces output of shape (B, 3).
    """
    B, src_embed_data, tgt_embed_data, src_features_data = inp

    model = ColorMapper()
    model.eval()

    src_embed = torch.tensor(src_embed_data, dtype=torch.float32)    # (B, 64)
    tgt_embed = torch.tensor(tgt_embed_data, dtype=torch.float32)    # (B, 64)
    src_features = torch.tensor(src_features_data, dtype=torch.float32)  # (B, 6)

    assert src_embed.shape == (B, 64)
    assert tgt_embed.shape == (B, 64)
    assert src_features.shape == (B, 6)

    with torch.no_grad():
        out = model(src_embed, tgt_embed, src_features)

    assert out.shape == (B, 3), f"Expected ({B}, 3), got {tuple(out.shape)}"


# ─── Unit tests for mapper training (Task 6.4) ───────────────────────────────
# Validates: Requirements 7.1


def test_frozen_encoder_has_no_grad() -> None:
    """Validates: Requirements 7.1

    After load_frozen_encoder(), all encoder parameters must have
    requires_grad=False.
    """
    encoder = PaletteEncoder()

    # Save a temporary encoder.pt
    with tempfile.TemporaryDirectory() as tmpdir:
        weights_path = Path(tmpdir) / "encoder.pt"
        torch.save(encoder.state_dict(), weights_path)

        frozen = load_frozen_encoder(weights_path)

    for name, param in frozen.named_parameters():
        assert not param.requires_grad, (
            f"Parameter '{name}' still has requires_grad=True after freezing"
        )


def test_missing_encoder_weights_exits() -> None:
    """Validates: Requirements 7.1

    load_frozen_encoder() must call sys.exit() with a non-zero code when the
    weights file does not exist.
    """
    import pytest

    missing_path = Path("/nonexistent/path/encoder.pt")

    with pytest.raises(SystemExit) as exc_info:
        load_frozen_encoder(missing_path)

    assert exc_info.value.code != 0, (
        "sys.exit() should be called with a non-zero exit code"
    )
