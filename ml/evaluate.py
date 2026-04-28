"""ml/evaluate.py — Baseline vs trained model RMSE evaluation.

Loads the trained PaletteEncoder and ColorMapper, computes naive baseline
RMSE (Role_Vector greedy matching) and trained model RMSE on the validation
set, reports per-component and combined weighted RMSE, logs the improvement
delta, and writes results to ml/results/evaluation.json.

Usage:
    python ml/evaluate.py
"""

import json
import math
import sys
from pathlib import Path
from typing import TYPE_CHECKING, Any

# Allow running as a standalone script from the repo root
sys.path.insert(0, str(Path(__file__).parent.parent))

from ml.generate_pairs import match_colors_greedy

if TYPE_CHECKING:
    import torch
    from ml.encoder import PaletteEncoder
    from ml.mapper import ColorMapper

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

DATA_DIR = Path("ml/data/processed")
MODELS_DIR = Path("ml/models")
RESULTS_DIR = Path("ml/results")
VAL_PAIRS_FILE = DATA_DIR / "pairs_val.json"
ENCODER_PATH = MODELS_DIR / "encoder.pt"
MAPPER_PATH = MODELS_DIR / "mapper.pt"
RESULTS_FILE = RESULTS_DIR / "evaluation.json"

# ---------------------------------------------------------------------------
# Public metric helpers
# ---------------------------------------------------------------------------


def per_component_rmse(
    preds: list[list[float]],
    targets: list[list[float]],
) -> tuple[float, float, float]:
    """Compute per-component RMSE for OKLCH predictions.

    For each component X ∈ {L, C, H}, computes:
        RMSE_X = sqrt(mean((pred_X - true_X)²))

    Args:
        preds: List of predicted OKLCH triples [[L, C, H/360], ...].
        targets: List of ground-truth OKLCH triples [[L, C, H/360], ...].

    Returns:
        Tuple (rmse_L, rmse_C, rmse_H).

    Raises:
        ValueError: If preds and targets have different lengths or are empty.
    """
    if len(preds) != len(targets):
        raise ValueError(
            f"preds and targets must have the same length, "
            f"got {len(preds)} and {len(targets)}"
        )
    if not preds:
        raise ValueError("preds and targets must not be empty")

    n = len(preds)
    sum_sq_L = sum_sq_C = sum_sq_H = 0.0
    for p, t in zip(preds, targets):
        sum_sq_L += (p[0] - t[0]) ** 2
        sum_sq_C += (p[1] - t[1]) ** 2
        sum_sq_H += (p[2] - t[2]) ** 2

    return (
        math.sqrt(sum_sq_L / n),
        math.sqrt(sum_sq_C / n),
        math.sqrt(sum_sq_H / n),
    )


def weighted_rmse(
    preds: list[list[float]],
    targets: list[list[float]],
) -> float:
    """Compute combined weighted RMSE for OKLCH predictions.

    Uses the same weighting as Weighted_MSE:
        RMSE_w = sqrt(mean(2*(dL)² + (dC)² + (dH)²))

    Args:
        preds: List of predicted OKLCH triples [[L, C, H/360], ...].
        targets: List of ground-truth OKLCH triples [[L, C, H/360], ...].

    Returns:
        Combined weighted RMSE as a float.

    Raises:
        ValueError: If preds and targets have different lengths or are empty.
    """
    if len(preds) != len(targets):
        raise ValueError(
            f"preds and targets must have the same length, "
            f"got {len(preds)} and {len(targets)}"
        )
    if not preds:
        raise ValueError("preds and targets must not be empty")

    n = len(preds)
    total = 0.0
    for p, t in zip(preds, targets):
        dL = p[0] - t[0]
        dC = p[1] - t[1]
        dH = p[2] - t[2]
        total += 2.0 * dL * dL + dC * dC + dH * dH

    return math.sqrt(total / n)


# ---------------------------------------------------------------------------
# Model loading
# ---------------------------------------------------------------------------


def load_encoder(path: Path) -> "PaletteEncoder":
    """Load a trained PaletteEncoder from saved weights.

    Args:
        path: Path to the encoder state dict file (encoder.pt).

    Returns:
        PaletteEncoder in eval mode.

    Raises:
        SystemExit: If the weights file does not exist.
    """
    import torch
    from ml.encoder import PaletteEncoder

    if not path.exists():
        print(
            f"ERROR: Encoder weights not found at {path}. "
            "Run ml/train_encoder.py first.",
            file=sys.stderr,
        )
        sys.exit(1)
    encoder = PaletteEncoder()
    encoder.load_state_dict(torch.load(path, map_location="cpu", weights_only=True))
    encoder.eval()
    return encoder


def load_mapper(path: Path) -> "ColorMapper":
    """Load a trained ColorMapper from saved weights.

    Args:
        path: Path to the mapper state dict file (mapper.pt).

    Returns:
        ColorMapper in eval mode.

    Raises:
        SystemExit: If the weights file does not exist.
    """
    import torch
    from ml.mapper import ColorMapper

    if not path.exists():
        print(
            f"ERROR: Mapper weights not found at {path}. "
            "Run ml/train_mapper.py first.",
            file=sys.stderr,
        )
        sys.exit(1)
    mapper = ColorMapper()
    mapper.load_state_dict(torch.load(path, map_location="cpu", weights_only=True))
    mapper.eval()
    return mapper


# ---------------------------------------------------------------------------
# Prediction helpers
# ---------------------------------------------------------------------------


def baseline_predictions(pairs: list[dict[str, Any]]) -> list[list[float]]:
    """Compute naive baseline predictions using Role_Vector greedy matching.

    For each validation pair, the baseline finds the closest target palette
    color to the source color by Role_Vector (greedy Euclidean distance over
    [normalized_L, normalized_C, is_warm]) and uses that target color's OKLCH
    as the prediction.

    Args:
        pairs: List of validation pair dicts with keys:
               'src_palette', 'tgt_palette', 'src_color', 'tgt_oklch'.

    Returns:
        List of predicted OKLCH triples [[L, C, H/360], ...].
    """
    predictions: list[list[float]] = []
    for pair in pairs:
        src_features: list[list[float]] = pair["src_palette"]
        tgt_features: list[list[float]] = pair["tgt_palette"]
        src_color: list[float] = pair["src_color"]

        # Find which source palette index this color corresponds to
        # by matching src_color to src_palette entries
        src_idx = 0
        best_dist = float("inf")
        for i, feat in enumerate(src_features):
            dist = sum((a - b) ** 2 for a, b in zip(feat, src_color))
            if dist < best_dist:
                best_dist = dist
                src_idx = i

        # Greedy match: find closest target color for this source color
        matches = match_colors_greedy(src_features, tgt_features)
        # Find the target index matched to our source index
        tgt_idx = next(ti for si, ti in matches if si == src_idx)

        # The baseline prediction is the matched target color's OKLCH
        # tgt_palette features have OKLCH at indices [0, 1, 2] (L, C, H/360)
        tgt_oklch_pred = tgt_features[tgt_idx][:3]
        predictions.append(tgt_oklch_pred)

    return predictions


def model_predictions(
    pairs: list[dict[str, Any]],
    encoder: "PaletteEncoder",
    mapper: "ColorMapper",
    device: "torch.device",
) -> list[list[float]]:
    """Compute trained model predictions for all validation pairs.

    For each pair, encodes both palettes with the PaletteEncoder, then
    runs the ColorMapper to predict the target color OKLCH.

    Args:
        pairs: List of validation pair dicts.
        encoder: Trained PaletteEncoder in eval mode.
        mapper: Trained ColorMapper in eval mode.
        device: Torch device to run inference on.

    Returns:
        List of predicted OKLCH triples [[L, C, H/360], ...].
    """
    import torch

    encoder = encoder.to(device)
    mapper = mapper.to(device)
    predictions: list[list[float]] = []

    with torch.no_grad():
        for pair in pairs:
            src_pal = torch.tensor(
                pair["src_palette"], dtype=torch.float32
            ).unsqueeze(0).to(device)  # (1, 4, 6)
            tgt_pal = torch.tensor(
                pair["tgt_palette"], dtype=torch.float32
            ).unsqueeze(0).to(device)  # (1, 4, 6)
            src_feat = torch.tensor(
                pair["src_color"], dtype=torch.float32
            ).unsqueeze(0).to(device)  # (1, 6)

            src_embed = encoder.encode(src_pal)   # (1, 64)
            tgt_embed = encoder.encode(tgt_pal)   # (1, 64)
            pred = mapper(src_embed, tgt_embed, src_feat)  # (1, 3)

            predictions.append(pred.squeeze(0).cpu().tolist())

    return predictions


# ---------------------------------------------------------------------------
# Main evaluation
# ---------------------------------------------------------------------------


def evaluate(
    val_pairs_file: Path = VAL_PAIRS_FILE,
    encoder_path: Path = ENCODER_PATH,
    mapper_path: Path = MAPPER_PATH,
    results_file: Path = RESULTS_FILE,
) -> dict[str, Any]:
    """Run full evaluation: baseline vs trained model RMSE on validation set.

    Loads models and validation pairs, computes both baseline and model
    predictions, reports per-component and combined weighted RMSE, logs
    the improvement delta, and writes results to JSON.

    Args:
        val_pairs_file: Path to pairs_val.json.
        encoder_path: Path to encoder.pt.
        mapper_path: Path to mapper.pt.
        results_file: Path to write evaluation.json.

    Returns:
        Dict containing all computed metrics.

    Raises:
        SystemExit: If any required file is missing.
    """
    # Load validation pairs
    if not val_pairs_file.exists():
        print(
            f"ERROR: Validation pairs not found at {val_pairs_file}. "
            "Run ml/generate_pairs.py first.",
            file=sys.stderr,
        )
        sys.exit(1)

    with open(val_pairs_file) as f:
        val_pairs: list[dict[str, Any]] = json.load(f)

    print(f"Loaded {len(val_pairs)} validation pairs from {val_pairs_file}")

    # Load models
    encoder = load_encoder(encoder_path)
    mapper = load_mapper(mapper_path)

    import torch
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Using device: {device}")

    # Ground-truth targets
    targets: list[list[float]] = [pair["tgt_oklch"] for pair in val_pairs]

    # Baseline predictions
    print("Computing baseline predictions (Role_Vector greedy matching)...")
    base_preds = baseline_predictions(val_pairs)

    # Model predictions
    print("Computing trained model predictions...")
    model_preds = model_predictions(val_pairs, encoder, mapper, device)

    # Compute metrics
    base_rmse_L, base_rmse_C, base_rmse_H = per_component_rmse(base_preds, targets)
    base_w_rmse = weighted_rmse(base_preds, targets)

    model_rmse_L, model_rmse_C, model_rmse_H = per_component_rmse(model_preds, targets)
    model_w_rmse = weighted_rmse(model_preds, targets)

    delta_L = base_rmse_L - model_rmse_L
    delta_C = base_rmse_C - model_rmse_C
    delta_H = base_rmse_H - model_rmse_H
    delta_w = base_w_rmse - model_w_rmse

    # Log results
    print("\n=== Evaluation Results ===")
    print(f"Validation pairs: {len(val_pairs)}")
    print()
    print("Naive Baseline RMSE:")
    print(f"  L:        {base_rmse_L:.6f}")
    print(f"  C:        {base_rmse_C:.6f}")
    print(f"  H:        {base_rmse_H:.6f}")
    print(f"  Weighted: {base_w_rmse:.6f}")
    print()
    print("Trained Model RMSE:")
    print(f"  L:        {model_rmse_L:.6f}")
    print(f"  C:        {model_rmse_C:.6f}")
    print(f"  H:        {model_rmse_H:.6f}")
    print(f"  Weighted: {model_w_rmse:.6f}")
    print()
    print("Improvement Delta (baseline - model):")
    print(f"  ΔL:        {delta_L:+.6f}")
    print(f"  ΔC:        {delta_C:+.6f}")
    print(f"  ΔH:        {delta_H:+.6f}")
    print(f"  ΔWeighted: {delta_w:+.6f}")

    results: dict[str, Any] = {
        "num_val_pairs": len(val_pairs),
        "baseline": {
            "rmse_L": base_rmse_L,
            "rmse_C": base_rmse_C,
            "rmse_H": base_rmse_H,
            "weighted_rmse": base_w_rmse,
        },
        "model": {
            "rmse_L": model_rmse_L,
            "rmse_C": model_rmse_C,
            "rmse_H": model_rmse_H,
            "weighted_rmse": model_w_rmse,
        },
        "delta": {
            "rmse_L": delta_L,
            "rmse_C": delta_C,
            "rmse_H": delta_H,
            "weighted_rmse": delta_w,
        },
    }

    # Write results
    results_file.parent.mkdir(parents=True, exist_ok=True)
    with open(results_file, "w") as f:
        json.dump(results, f, indent=2)
    print(f"\nResults written to {results_file}")

    return results


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    evaluate()
