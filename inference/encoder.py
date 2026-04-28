"""inference/encoder.py — PaletteEncoder wrapper for inference.

Loads trained PaletteEncoder weights and exposes a simple encode() function
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

from ml.encoder import PaletteEncoder  # noqa: E402


class EncoderWrapper:
    """Wraps a loaded PaletteEncoder for inference.

    Loads model weights from disk and provides a simple encode() interface
    that accepts a palette feature tensor and returns its embedding.
    """

    def __init__(self, model_path: str | Path) -> None:
        """Load PaletteEncoder weights from a file.

        Args:
            model_path: Path to the saved encoder state dict (.pt file).

        Raises:
            FileNotFoundError: If the model file does not exist.
            RuntimeError: If the weights cannot be loaded.
        """
        model_path = Path(model_path)
        if not model_path.exists():
            raise FileNotFoundError(f"Encoder weights not found: {model_path}")

        self._model = PaletteEncoder()
        state = torch.load(model_path, map_location="cpu", weights_only=True)
        self._model.load_state_dict(state)
        self._model.eval()

    def encode(self, palette_features: Tensor) -> Tensor:
        """Encode a palette into a 64-dimensional embedding.

        Args:
            palette_features: Tensor of shape (B, 4, 6) — a batch of palettes,
                each with 4 colors represented as 6D feature vectors.

        Returns:
            Tensor of shape (B, 64) — the palette embeddings.
        """
        with torch.no_grad():
            return self._model.encode(palette_features)
