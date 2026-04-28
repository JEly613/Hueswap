"""inference/mapper.py — ColorMapper wrapper for inference.

Loads trained ColorMapper weights and exposes a simple predict() function
for use by the FastAPI inference service.
"""

import sys
from pathlib import Path

import torch
from torch import Tensor

# Allow importing from the ml/ package at the repo root
_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from ml.mapper import ColorMapper  # noqa: E402


class MapperWrapper:
    """Wraps a loaded ColorMapper for inference.

    Loads model weights from disk and provides a simple predict() interface
    that accepts palette embeddings and a source feature vector, returning
    the predicted target OKLCH values.
    """

    def __init__(self, model_path: str | Path) -> None:
        """Load ColorMapper weights from a file.

        Args:
            model_path: Path to the saved mapper state dict (.pt file).

        Raises:
            FileNotFoundError: If the model file does not exist.
            RuntimeError: If the weights cannot be loaded.
        """
        model_path = Path(model_path)
        if not model_path.exists():
            raise FileNotFoundError(f"Mapper weights not found: {model_path}")

        self._model = ColorMapper()
        state = torch.load(model_path, map_location="cpu", weights_only=True)
        self._model.load_state_dict(state)
        self._model.eval()

    def predict(
        self,
        src_embed: Tensor,
        tgt_embed: Tensor,
        src_features: Tensor,
    ) -> Tensor:
        """Predict target color OKLCH values.

        Args:
            src_embed: Source palette embedding of shape (B, 64).
            tgt_embed: Target palette embedding of shape (B, 64).
            src_features: Source color feature vector of shape (B, 6).

        Returns:
            Predicted target OKLCH tensor of shape (B, 3) — [L, C, H/360].
        """
        with torch.no_grad():
            return self._model(src_embed, tgt_embed, src_features)
