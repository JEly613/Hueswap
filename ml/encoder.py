"""ml/encoder.py — PaletteEncoder architecture (Stage 1).

Transformer-based encoder with two code paths:
- forward(): masked color prediction for self-supervised training
- encode(): full palette embedding for inference
"""

import torch
import torch.nn as nn
from torch import Tensor


class PaletteEncoder(nn.Module):
    """Transformer-based palette encoder with masked color prediction.

    Learns permutation-invariant palette embeddings via self-supervised
    masked color prediction. Uses mean pooling for permutation invariance.

    Architecture:
        color_embed: Linear(6, 64)
        transformer: TransformerEncoder(2 layers, 4 heads, ff=128, batch_first=True)
        pool: mean over sequence dimension
        predict_head: Linear(64, 3)
    """

    def __init__(self, embed_dim: int = 64, num_heads: int = 4, num_layers: int = 2) -> None:
        """Initialise PaletteEncoder.

        Args:
            embed_dim: Dimension of color embeddings and transformer hidden state.
            num_heads: Number of attention heads in the transformer.
            num_layers: Number of transformer encoder layers.
        """
        super().__init__()

        self.color_embed = nn.Linear(6, embed_dim)

        encoder_layer = nn.TransformerEncoderLayer(
            d_model=embed_dim,
            nhead=num_heads,
            dim_feedforward=128,
            batch_first=True,
        )
        self.transformer = nn.TransformerEncoder(encoder_layer, num_layers=num_layers)

        self.predict_head = nn.Linear(embed_dim, 3)

    def _embed_and_pool(self, x: Tensor) -> Tensor:
        """Shared embedding + transformer + mean pool step.

        Args:
            x: Input tensor of shape (B, S, 6) where S is sequence length.

        Returns:
            Pooled tensor of shape (B, embed_dim).
        """
        embedded = self.color_embed(x)          # (B, S, 64)
        encoded = self.transformer(embedded)     # (B, S, 64)
        pooled = encoded.mean(dim=1)             # (B, 64)
        return pooled

    def forward(self, x: Tensor) -> Tensor:
        """Training path: masked color prediction.

        Takes 3 visible colors and predicts the masked color's OKLCH values.

        Args:
            x: Input tensor of shape (B, 3, 6) — 3 visible colors as 6D feature vectors.

        Returns:
            Predicted OKLCH tensor of shape (B, 3) — [L, C, H/360] of masked color.
        """
        pooled = self._embed_and_pool(x)         # (B, 64)
        return self.predict_head(pooled)          # (B, 3)

    def encode(self, x: Tensor) -> Tensor:
        """Inference path: full palette embedding.

        Takes a complete 4-color palette and returns its 64-dimensional embedding.

        Args:
            x: Input tensor of shape (B, 4, 6) — full palette as 6D feature vectors.

        Returns:
            Palette embedding tensor of shape (B, 64).
        """
        return self._embed_and_pool(x)            # (B, 64)
