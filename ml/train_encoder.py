"""ml/train_encoder.py — Train Stage 1 PaletteEncoder.

Self-supervised training via masked color prediction:
- For each 4-color palette, generate 4 examples (mask each color in turn).
- Input: 3 visible colors as (3, 6) feature tensors.
- Target: masked color's OKLCH values [L, C, H/360].
- Loss: Weighted_MSE = 2*(dL)^2 + (dC)^2 + (dH)^2

Usage:
    python ml/train_encoder.py
"""

import json
import os
import sys
from pathlib import Path
from typing import Any

import torch
import torch.nn as nn
from torch import Tensor
from torch.utils.data import DataLoader, Dataset

# Allow running as a standalone script from the repo root
sys.path.insert(0, str(Path(__file__).parent.parent))

from ml.encoder import PaletteEncoder

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

DATA_DIR = Path("ml/data/processed")
MODELS_DIR = Path("ml/models")
TRAIN_FILE = DATA_DIR / "palettes_train.json"
VAL_FILE = DATA_DIR / "palettes_val.json"
ENCODER_PATH = MODELS_DIR / "encoder.pt"

# ---------------------------------------------------------------------------
# Public helpers (also used by property tests)
# ---------------------------------------------------------------------------


def generate_masked_examples(
    palette_features: list[list[float]],
) -> list[tuple[list[list[float]], list[float]]]:
    """Generate 4 masked training examples from a single palette.

    For each position i in [0, 1, 2, 3], the masked color becomes the target
    and the remaining 3 colors form the input.

    Args:
        palette_features: List of 4 color feature vectors, each of length 6.
            Format: [[L, C, H/360, nL, nC, warm], ...]

    Returns:
        List of 4 tuples (input_colors, target_oklch) where:
            - input_colors: list of 3 feature vectors (the visible colors)
            - target_oklch: [L, C, H/360] of the masked color
    """
    examples: list[tuple[list[list[float]], list[float]]] = []
    for i in range(4):
        visible = [palette_features[j] for j in range(4) if j != i]
        target = palette_features[i][:3]  # [L, C, H/360]
        examples.append((visible, target))
    return examples


def weighted_mse_loss(pred: Tensor, target: Tensor) -> Tensor:
    """Compute Weighted_MSE loss over a batch of OKLCH predictions.

    Loss = mean over batch of: 2*(pred_L - true_L)^2 + (pred_C - true_C)^2 + (pred_H - true_H)^2

    Args:
        pred: Predicted OKLCH tensor of shape (B, 3) — [L, C, H/360].
        target: Ground-truth OKLCH tensor of shape (B, 3) — [L, C, H/360].

    Returns:
        Scalar loss tensor.
    """
    diff = pred - target                          # (B, 3)
    weights = pred.new_tensor([2.0, 1.0, 1.0])   # [wL, wC, wH]
    weighted = weights * diff * diff              # (B, 3)
    return weighted.sum(dim=1).mean()             # scalar


# ---------------------------------------------------------------------------
# Dataset
# ---------------------------------------------------------------------------


class MaskedPaletteDataset(Dataset):
    """PyTorch Dataset that expands processed palettes into masked examples.

    Each palette of 4 colors yields 4 training examples (one per masked position).
    """

    def __init__(self, palettes: list[dict[str, Any]]) -> None:
        """Initialise dataset from a list of processed palette dicts.

        Args:
            palettes: List of palette dicts with a 'features' key containing
                      a list of 4 six-dimensional feature vectors.
        """
        self.examples: list[tuple[list[list[float]], list[float]]] = []
        for palette in palettes:
            self.examples.extend(generate_masked_examples(palette["features"]))

    def __len__(self) -> int:
        """Return total number of masked examples."""
        return len(self.examples)

    def __getitem__(self, idx: int) -> tuple[Tensor, Tensor]:
        """Return (input_tensor, target_tensor) for a single example.

        Returns:
            input_tensor: shape (3, 6)
            target_tensor: shape (3,)
        """
        visible, target = self.examples[idx]
        x = torch.tensor(visible, dtype=torch.float32)   # (3, 6)
        y = torch.tensor(target, dtype=torch.float32)    # (3,)
        return x, y


# ---------------------------------------------------------------------------
# Training
# ---------------------------------------------------------------------------


def load_palettes(path: Path) -> list[dict[str, Any]]:
    """Load processed palettes from a JSON file.

    Args:
        path: Path to the JSON file containing a list of palette dicts.

    Returns:
        List of palette dicts.

    Raises:
        SystemExit: If the file does not exist.
    """
    if not path.exists():
        print(f"ERROR: Data file not found: {path}", file=sys.stderr)
        sys.exit(1)
    with open(path) as f:
        return json.load(f)


def train(
    batch_size: int = 32,
    lr: float = 1e-3,
    epochs: int = 20,
    log_interval: int = 100,
) -> None:
    """Train the PaletteEncoder and save weights to ml/models/encoder.pt.

    Args:
        batch_size: Number of examples per training batch.
        lr: Learning rate for the Adam optimiser.
        epochs: Number of full passes over the training data.
        log_interval: Log training loss every this many batches.
    """
    # Load data
    train_palettes = load_palettes(TRAIN_FILE)
    val_palettes = load_palettes(VAL_FILE)

    train_dataset = MaskedPaletteDataset(train_palettes)
    val_dataset = MaskedPaletteDataset(val_palettes)

    train_loader = DataLoader(train_dataset, batch_size=batch_size, shuffle=True)
    val_loader = DataLoader(val_dataset, batch_size=batch_size, shuffle=False)

    print(f"Train examples: {len(train_dataset)}, Val examples: {len(val_dataset)}")

    # Model + optimiser
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = PaletteEncoder().to(device)
    optimiser = torch.optim.Adam(model.parameters(), lr=lr)

    # Ensure output directory exists
    MODELS_DIR.mkdir(parents=True, exist_ok=True)

    for epoch in range(1, epochs + 1):
        # --- Training ---
        model.train()
        running_loss = 0.0
        for batch_idx, (x, y) in enumerate(train_loader, start=1):
            x, y = x.to(device), y.to(device)
            optimiser.zero_grad()
            pred = model(x)
            loss = weighted_mse_loss(pred, y)
            loss.backward()
            optimiser.step()

            running_loss += loss.item()
            if batch_idx % log_interval == 0:
                avg = running_loss / log_interval
                print(f"Epoch {epoch} | Batch {batch_idx} | Train loss: {avg:.6f}")
                running_loss = 0.0

        # --- Validation ---
        model.eval()
        val_loss = 0.0
        with torch.no_grad():
            for x, y in val_loader:
                x, y = x.to(device), y.to(device)
                pred = model(x)
                val_loss += weighted_mse_loss(pred, y).item()
        val_loss /= len(val_loader)
        print(f"Epoch {epoch} | Val loss: {val_loss:.6f}")

    # Save weights
    torch.save(model.state_dict(), ENCODER_PATH)
    print(f"Encoder weights saved to {ENCODER_PATH}")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    train()
