"""ml/mapper.py — ColorMapper architecture (Stage 2).

MLP that maps a source color to its target OKLCH values given frozen
palette embeddings from the PaletteEncoder.
"""

import torch
import torch.nn as nn
from torch import Tensor


class ColorMapper(nn.Module):
    """MLP that predicts target color OKLCH from palette embeddings.

    Takes a source palette embedding, target palette embedding, and source
    color feature vector, concatenates them into a 134-dimensional vector,
    and passes through a sequential MLP to predict the target color's OKLCH.

    Architecture:
        net: Linear(134, 128) → ReLU → Dropout(0.1)
           → Linear(128, 128) → ReLU → Dropout(0.1)
           → Linear(128, 64)  → ReLU
           → Linear(64, 3)
    """

    def __init__(self, embed_dim: int = 64) -> None:
        """Initialise ColorMapper.

        Args:
            embed_dim: Dimension of each palette embedding (default 64).
                       Input size is 2 * embed_dim + 6 = 134.
        """
        super().__init__()

        input_dim = 2 * embed_dim + 6  # 64 + 64 + 6 = 134

        self.net = nn.Sequential(
            nn.Linear(input_dim, 128),
            nn.ReLU(),
            nn.Dropout(0.1),
            nn.Linear(128, 128),
            nn.ReLU(),
            nn.Dropout(0.1),
            nn.Linear(128, 64),
            nn.ReLU(),
            nn.Linear(64, 3),
        )

    def forward(
        self,
        src_embed: Tensor,
        tgt_embed: Tensor,
        src_features: Tensor,
    ) -> Tensor:
        """Predict target color OKLCH values.

        Concatenates the three inputs along the feature dimension and passes
        the result through the MLP.

        Args:
            src_embed: Source palette embedding of shape (B, 64).
            tgt_embed: Target palette embedding of shape (B, 64).
            src_features: Source color feature vector of shape (B, 6).

        Returns:
            Predicted target OKLCH tensor of shape (B, 3) — [L, C, H/360].
        """
        x = torch.cat([src_embed, tgt_embed, src_features], dim=1)  # (B, 134)
        return self.net(x)  # (B, 3)
