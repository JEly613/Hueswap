"""inference/main.py — FastAPI inference service for Hueswap ML layer.

Loads trained PaletteEncoder and ColorMapper on startup, then serves:
  POST /predict  — predict target OKLCH for a source color given two palettes
  GET  /health   — liveness check

Model paths default to ml/models/ relative to the repo root, but can be
overridden via the MODEL_DIR environment variable.

Usage:
    uvicorn inference.main:app --host 0.0.0.0 --port 8000
"""

import os
import re
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated

import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, field_validator, model_validator

# ── sys.path setup so we can import from ml/ ─────────────────────────────────
_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from ml.preprocess import compute_feature_vector, hex_to_oklch  # noqa: E402
from inference.encoder import EncoderWrapper  # noqa: E402
from inference.mapper import MapperWrapper  # noqa: E402

# ── Globals (populated on startup) ───────────────────────────────────────────
_encoder: EncoderWrapper | None = None
_mapper: MapperWrapper | None = None

_HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


# ── Lifespan (startup / shutdown) ────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load model weights on startup; exit non-zero if they are missing."""
    global _encoder, _mapper

    model_dir = Path(os.environ.get("MODEL_DIR", str(_REPO_ROOT / "ml" / "models")))

    encoder_path = model_dir / "encoder.pt"
    mapper_path = model_dir / "mapper.pt"

    try:
        _encoder = EncoderWrapper(encoder_path)
    except (FileNotFoundError, RuntimeError) as exc:
        print(f"[FATAL] Failed to load encoder from {encoder_path}: {exc}", file=sys.stderr)
        sys.exit(1)

    try:
        _mapper = MapperWrapper(mapper_path)
    except (FileNotFoundError, RuntimeError) as exc:
        print(f"[FATAL] Failed to load mapper from {mapper_path}: {exc}", file=sys.stderr)
        sys.exit(1)

    yield  # application runs here


app = FastAPI(title="Hueswap Inference Service", lifespan=lifespan)


# ── Pydantic models ───────────────────────────────────────────────────────────

class PredictRequest(BaseModel):
    """Request body for POST /predict."""

    source_palette: list[str]
    target_palette: list[str]
    source_features: list[float]

    @field_validator("source_palette", "target_palette")
    @classmethod
    def validate_palette(cls, v: list[str]) -> list[str]:
        """Validate that each palette has exactly 4 valid hex colors."""
        if len(v) != 4:
            raise ValueError(f"palette must have exactly 4 colors, got {len(v)}")
        for color in v:
            if not _HEX_RE.match(color):
                raise ValueError(
                    f"invalid hex color '{color}'; expected format #RRGGBB"
                )
        return v

    @field_validator("source_features")
    @classmethod
    def validate_source_features(cls, v: list[float]) -> list[float]:
        """Validate that source_features has exactly 6 floats."""
        if len(v) != 6:
            raise ValueError(
                f"source_features must have exactly 6 elements, got {len(v)}"
            )
        return v


class PredictResponse(BaseModel):
    """Response body for POST /predict."""

    oklch: list[float]  # [L, C, H] where H is in degrees [0, 360]


class HealthResponse(BaseModel):
    """Response body for GET /health."""

    status: str


# ── Helper functions ──────────────────────────────────────────────────────────

def palette_to_features(hex_colors: list[str]) -> list[list[float]]:
    """Convert a list of 4 hex colors to a list of 6D feature vectors.

    Uses the same hex_to_oklch and compute_feature_vector functions as the
    Python preprocessor (ml/preprocess.py), which match the TypeScript
    computeFeatureVector() implementation.

    Args:
        hex_colors: List of 4 hex color strings (e.g. ['#aabbcc', ...]).

    Returns:
        List of 4 feature vectors, each a list of 6 floats.

    Raises:
        HTTPException: 422 if any hex color fails OKLCH conversion.
    """
    oklch_values: list[tuple[float, float, float]] = []
    for hex_color in hex_colors:
        result = hex_to_oklch(hex_color)
        if result is None:
            raise HTTPException(
                status_code=422,
                detail=f"Failed to convert hex color '{hex_color}' to OKLCH",
            )
        oklch_values.append(result)

    Ls = [c[0] for c in oklch_values]
    Cs = [c[1] for c in oklch_values]
    min_L, max_L = min(Ls), max(Ls)
    min_C, max_C = min(Cs), max(Cs)

    features: list[list[float]] = []
    for L, C, H in oklch_values:
        fv = compute_feature_vector(L, C, H, min_L, max_L, min_C, max_C)
        features.append(fv)

    return features


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    """Liveness check.

    Returns:
        JSON ``{"status": "ok"}`` with HTTP 200 when models are loaded.
    """
    return HealthResponse(status="ok")


@app.post("/predict", response_model=PredictResponse)
def predict(request: PredictRequest) -> PredictResponse:
    """Predict the target OKLCH color for a source color given two palettes.

    Computes 6D feature vectors for both palettes, encodes them with the
    PaletteEncoder, then runs the ColorMapper to predict the target color.

    Args:
        request: Validated request containing source_palette, target_palette,
                 and source_features.

    Returns:
        JSON ``{"oklch": [L, C, H]}`` where H is in degrees [0, 360].

    Raises:
        HTTPException: 422 on invalid input (handled by Pydantic validators).
    """
    # Compute palette feature tensors
    src_features_list = palette_to_features(request.source_palette)
    tgt_features_list = palette_to_features(request.target_palette)

    # Shape: (1, 4, 6)
    src_tensor = torch.tensor([src_features_list], dtype=torch.float32)
    tgt_tensor = torch.tensor([tgt_features_list], dtype=torch.float32)

    # Encode both palettes → (1, 64)
    src_embed = _encoder.encode(src_tensor)
    tgt_embed = _encoder.encode(tgt_tensor)

    # Source color features → (1, 6)
    src_color = torch.tensor([request.source_features], dtype=torch.float32)

    # Predict target OKLCH → (1, 3) with H normalized to [0, 1]
    tgt_oklch = _mapper.predict(src_embed, tgt_embed, src_color)

    L, C, H_norm = tgt_oklch[0].tolist()

    # H from model is normalized [0, 1]; convert to degrees for the response
    H_deg = H_norm * 360.0

    return PredictResponse(oklch=[L, C, H_deg])
