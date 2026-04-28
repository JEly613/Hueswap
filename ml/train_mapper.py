"""ml/train_mapper.py — Train Stage 2 ColorMapper.

Loads a frozen PaletteEncoder, computes palette embeddings for each training
pair, then trains the ColorMapper with Weighted_MSE loss and curriculum
learning (similar pairs first in early epochs, shuffled later).

Usage:
    python ml/train_mapper.py
"""

import json
import sys
from pathlib import Path
from typing import Any

import torch
from torch import Tensor
from torch.utils.data import DataLoader, Dataset

# Allow running as a standalone script from the repo root
sys.path.insert(0, str(Path(__file__).parent.parent))

from ml.encoder import PaletteEncoder
from ml.mapper import ColorMapper
from ml.train_encoder import weighted_mse_loss

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

DATA_DIR = Path("ml/data/processed")
MODELS_DIR = Path("ml/models")
TRAIN_PAIRS_FILE = DATA_DIR / "pairs_train.json"
VAL_PAIRS_FILE = DATA_DIR / "pairs_val.json"
ENCODER_PATH = MODELS_DIR / "encoder.pt"
MAPPER_PATH = MODELS_DIR / "mapper.pt"

# ---------------------------------------------------------------------------
# Public helpers
# ---------------------------------------------------------------------------


def load_frozen_encoder(path: Path) -> PaletteEncoder:
    """Load a trained PaletteEncoder and freeze all its parameters.

    Args:
        path: Path to the saved encoder state dict (encoder.pt).

    Returns:
        PaletteEncoder with all parameters frozen (requires_grad=False).

    Raises:
        SystemExit: If the weights file does not exist.
    """
    if not path.exists():
        print(
            f"ERROR: Encoder weights not found at {path}. "
            "Run ml/train_encoder.py first.",
            file=sys.stderr,
        )
        sys.exit(1)

    encoder = PaletteEncoder()
    encoder.load_state_dict(torch.load(path, map_location="cpu", weights_only=True))

    for param in encoder.parameters():
        param.requires_grad = False

    encoder.eval()
    return encoder


# ---------------------------------------------------------------------------
# Dataset
# ---------------------------------------------------------------------------


class PairDataset(Dataset):
    """Dataset of palette pairs for mapper training.

    Each item is a training pair with pre-computed palette embeddings and
    source color features.
    """

    def __init__(
        self,
        pairs: list[dict[str, Any]],
        encoder: PaletteEncoder,
        device: torch.device,
    ) -> None:
        """Initialise dataset by pre-computing palette embeddings.

        Args:
            pairs: List of pair dicts with keys:
                   'src_palette', 'tgt_palette', 'src_color', 'tgt_oklch'.
            encoder: Frozen PaletteEncoder used to compute embeddings.
            device: Device to run encoder on.
        """
        self.items: list[tuple[Tensor, Tensor, Tensor, Tensor]] = []

        encoder = encoder.to(device)
        encoder.eval()

        with torch.no_grad():
            for pair in pairs:
                src_pal = torch.tensor(
                    pair["src_palette"], dtype=torch.float32
                ).unsqueeze(0).to(device)  # (1, 4, 6)
                tgt_pal = torch.tensor(
                    pair["tgt_palette"], dtype=torch.float32
                ).unsqueeze(0).to(device)  # (1, 4, 6)

                src_embed = encoder.encode(src_pal).squeeze(0).cpu()  # (64,)
                tgt_embed = encoder.encode(tgt_pal).squeeze(0).cpu()  # (64,)

                src_features = torch.tensor(
                    pair["src_color"], dtype=torch.float32
                )  # (6,)
                tgt_oklch = torch.tensor(
                    pair["tgt_oklch"], dtype=torch.float32
                )  # (3,)

                self.items.append((src_embed, tgt_embed, src_features, tgt_oklch))

    def __len__(self) -> int:
        """Return number of training pairs."""
        return len(self.items)

    def __getitem__(
        self, idx: int
    ) -> tuple[Tensor, Tensor, Tensor, Tensor]:
        """Return (src_embed, tgt_embed, src_features, tgt_oklch) for one pair."""
        return self.items[idx]


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------


def load_pairs(path: Path) -> list[dict[str, Any]]:
    """Load training pairs from a JSON file.

    Args:
        path: Path to the JSON file containing a list of pair dicts.

    Returns:
        List of pair dicts.

    Raises:
        SystemExit: If the file does not exist.
    """
    if not path.exists():
        print(f"ERROR: Pairs file not found: {path}", file=sys.stderr)
        sys.exit(1)
    with open(path) as f:
        return json.load(f)


# ---------------------------------------------------------------------------
# Training
# ---------------------------------------------------------------------------


def train(
    batch_size: int = 32,
    lr: float = 1e-3,
    epochs: int = 20,
    log_interval: int = 100,
    curriculum_epochs: int = 10,
) -> None:
    """Train the ColorMapper and save weights to ml/models/mapper.pt.

    Curriculum learning strategy:
    - Pairs in pairs_train.json are already sorted by average Role_Vector
      distance (similar first) from the pair generator.
    - For the first `curriculum_epochs` epochs, pairs are used in order
      (similar pairs first).
    - For remaining epochs, pairs are shuffled to expose diverse pairs.

    Args:
        batch_size: Number of examples per training batch.
        lr: Learning rate for the Adam optimiser.
        epochs: Number of full passes over the training data.
        log_interval: Log training loss every this many batches.
        curriculum_epochs: Number of epochs to use curriculum ordering before
                           switching to random shuffling.
    """
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    # Load frozen encoder
    encoder = load_frozen_encoder(ENCODER_PATH)

    # Load pairs
    train_pairs = load_pairs(TRAIN_PAIRS_FILE)
    val_pairs = load_pairs(VAL_PAIRS_FILE)

    print(f"Train pairs: {len(train_pairs)}, Val pairs: {len(val_pairs)}")

    # Pre-compute embeddings
    print("Pre-computing palette embeddings...")
    train_dataset = PairDataset(train_pairs, encoder, device)
    val_dataset = PairDataset(val_pairs, encoder, device)

    val_loader = DataLoader(val_dataset, batch_size=batch_size, shuffle=False)

    # Model + optimiser
    mapper = ColorMapper().to(device)
    optimiser = torch.optim.Adam(mapper.parameters(), lr=lr)

    # Ensure output directory exists
    MODELS_DIR.mkdir(parents=True, exist_ok=True)

    for epoch in range(1, epochs + 1):
        # Curriculum: use ordered pairs for early epochs, shuffle later
        shuffle = epoch > curriculum_epochs
        train_loader = DataLoader(
            train_dataset, batch_size=batch_size, shuffle=shuffle
        )

        # --- Training ---
        mapper.train()
        running_loss = 0.0
        for batch_idx, (src_emb, tgt_emb, src_feat, tgt_oklch) in enumerate(
            train_loader, start=1
        ):
            src_emb = src_emb.to(device)
            tgt_emb = tgt_emb.to(device)
            src_feat = src_feat.to(device)
            tgt_oklch = tgt_oklch.to(device)

            optimiser.zero_grad()
            pred = mapper(src_emb, tgt_emb, src_feat)
            loss = weighted_mse_loss(pred, tgt_oklch)
            loss.backward()
            optimiser.step()

            running_loss += loss.item()
            if batch_idx % log_interval == 0:
                avg = running_loss / log_interval
                mode = "curriculum" if not shuffle else "shuffled"
                print(
                    f"Epoch {epoch} [{mode}] | Batch {batch_idx} | "
                    f"Train loss: {avg:.6f}"
                )
                running_loss = 0.0

        # --- Validation ---
        mapper.eval()
        val_loss = 0.0
        with torch.no_grad():
            for src_emb, tgt_emb, src_feat, tgt_oklch in val_loader:
                src_emb = src_emb.to(device)
                tgt_emb = tgt_emb.to(device)
                src_feat = src_feat.to(device)
                tgt_oklch = tgt_oklch.to(device)
                pred = mapper(src_emb, tgt_emb, src_feat)
                val_loss += weighted_mse_loss(pred, tgt_oklch).item()
        val_loss /= len(val_loader)
        print(f"Epoch {epoch} | Val loss: {val_loss:.6f}")

    # Save weights
    torch.save(mapper.state_dict(), MAPPER_PATH)
    print(f"Mapper weights saved to {MAPPER_PATH}")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    train()
