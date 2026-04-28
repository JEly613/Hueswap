"""Tests for the FastAPI inference service (inference/main.py).

Includes:
- Property 13: Inference returns valid OKLCH ranges (task 9.4)
  **Validates: Requirements 9.3**
- Unit tests for validation and health endpoint (task 9.5)
  Validates: Requirements 9.4, 9.6
"""

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
import torch
from fastapi.testclient import TestClient
from hypothesis import given, settings
from hypothesis import strategies as st

# Ensure repo root is on sys.path so inference/ and ml/ are importable
_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))


# ── Fixtures / helpers ────────────────────────────────────────────────────────

def _make_mock_encoder():
    """Return a mock EncoderWrapper whose encode() returns a (1, 64) tensor."""
    mock = MagicMock()
    mock.encode.return_value = torch.zeros(1, 64)
    return mock


def _make_mock_mapper(L: float = 0.5, C: float = 0.1, H_norm: float = 0.5):
    """Return a mock MapperWrapper whose predict() returns fixed OKLCH values."""
    mock = MagicMock()
    mock.predict.return_value = torch.tensor([[L, C, H_norm]])
    return mock


def _make_mock_mapper_random():
    """Return a mock MapperWrapper whose predict() returns random valid OKLCH."""
    mock = MagicMock()

    def _random_predict(*args, **kwargs):
        L = torch.rand(1).item()          # [0, 1]
        C = torch.rand(1).item() * 0.4   # [0, 0.4]
        H_norm = torch.rand(1).item()     # [0, 1] → will be ×360 in main.py
        return torch.tensor([[L, C, H_norm]])

    mock.predict.side_effect = _random_predict
    return mock


def _get_test_client() -> TestClient:
    """Build a TestClient with mocked encoder and mapper (no real weights needed)."""
    import inference.main as main_module

    main_module._encoder = _make_mock_encoder()
    main_module._mapper = _make_mock_mapper_random()

    # Bypass the lifespan so TestClient doesn't try to load weights
    from fastapi import FastAPI
    from inference.main import health, predict

    bare_app = FastAPI()
    bare_app.add_api_route("/health", health, methods=["GET"])
    bare_app.add_api_route("/predict", predict, methods=["POST"])
    return TestClient(bare_app)


# ── Strategies ────────────────────────────────────────────────────────────────

_HEX_CHARS = "0123456789abcdef"


@st.composite
def hex_color(draw) -> str:
    """Generate a valid #RRGGBB hex color string."""
    body = draw(st.text(alphabet=_HEX_CHARS, min_size=6, max_size=6))
    return f"#{body}"


@st.composite
def hex_palette(draw) -> list[str]:
    """Generate a list of 4 valid hex color strings."""
    return [draw(hex_color()) for _ in range(4)]


@st.composite
def feature_vector(draw) -> list[float]:
    """Generate a valid 6D feature vector."""
    L = draw(st.floats(min_value=0.0, max_value=1.0, allow_nan=False))
    C = draw(st.floats(min_value=0.0, max_value=0.4, allow_nan=False))
    H_norm = draw(st.floats(min_value=0.0, max_value=1.0, allow_nan=False))
    nL = draw(st.floats(min_value=0.0, max_value=1.0, allow_nan=False))
    nC = draw(st.floats(min_value=0.0, max_value=1.0, allow_nan=False))
    warm = draw(st.sampled_from([0.0, 1.0]))
    return [L, C, H_norm, nL, nC, warm]


# ── Property 13: Inference returns valid OKLCH ranges ────────────────────────

@given(
    src_palette=hex_palette(),
    tgt_palette=hex_palette(),
    src_features=feature_vector(),
)
@settings(max_examples=100)
def test_property_13_inference_valid_oklch_ranges(
    src_palette: list[str],
    tgt_palette: list[str],
    src_features: list[float],
):
    """**Validates: Requirements 9.3**

    Property 13: For any valid request with 4-color hex palettes and a 6D
    feature vector, the response OKLCH has L ∈ [0,1], C ∈ [0,0.4], H ∈ [0,360].

    The encoder and mapper are mocked to return random valid tensors so the
    test does not require actual model weights.
    """
    import inference.main as main_module

    # Fresh random mock for each example
    main_module._encoder = _make_mock_encoder()
    main_module._mapper = _make_mock_mapper_random()

    from fastapi import FastAPI
    from inference.main import predict

    bare_app = FastAPI()
    bare_app.add_api_route("/predict", predict, methods=["POST"])
    client = TestClient(bare_app)

    payload = {
        "source_palette": src_palette,
        "target_palette": tgt_palette,
        "source_features": src_features,
    }
    response = client.post("/predict", json=payload)

    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
    data = response.json()
    assert "oklch" in data
    L, C, H = data["oklch"]

    assert 0.0 <= L <= 1.0, f"L={L} out of [0, 1]"
    assert 0.0 <= C <= 0.4, f"C={C} out of [0, 0.4]"
    assert 0.0 <= H <= 360.0, f"H={H} out of [0, 360]"


# ── Unit tests ────────────────────────────────────────────────────────────────

VALID_PALETTE = ["#ff0000", "#00ff00", "#0000ff", "#ffffff"]
VALID_FEATURES = [0.5, 0.1, 0.5, 0.5, 0.5, 1.0]


@pytest.fixture
def client():
    """TestClient with mocked models (no real weights required)."""
    return _get_test_client()


def test_health_returns_200_ok(client: TestClient):
    """GET /health returns 200 with {status: 'ok'}. Validates: Requirements 9.6"""
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_predict_missing_source_palette_returns_422(client: TestClient):
    """POST /predict with missing source_palette returns 422. Validates: Requirements 9.4"""
    payload = {
        "target_palette": VALID_PALETTE,
        "source_features": VALID_FEATURES,
    }
    response = client.post("/predict", json=payload)
    assert response.status_code == 422


def test_predict_missing_target_palette_returns_422(client: TestClient):
    """POST /predict with missing target_palette returns 422. Validates: Requirements 9.4"""
    payload = {
        "source_palette": VALID_PALETTE,
        "source_features": VALID_FEATURES,
    }
    response = client.post("/predict", json=payload)
    assert response.status_code == 422


def test_predict_missing_source_features_returns_422(client: TestClient):
    """POST /predict with missing source_features returns 422. Validates: Requirements 9.4"""
    payload = {
        "source_palette": VALID_PALETTE,
        "target_palette": VALID_PALETTE,
    }
    response = client.post("/predict", json=payload)
    assert response.status_code == 422


def test_predict_invalid_hex_in_source_palette_returns_422(client: TestClient):
    """POST /predict with invalid hex in source_palette returns 422. Validates: Requirements 9.4"""
    payload = {
        "source_palette": ["#gg0000", "#00ff00", "#0000ff", "#ffffff"],
        "target_palette": VALID_PALETTE,
        "source_features": VALID_FEATURES,
    }
    response = client.post("/predict", json=payload)
    assert response.status_code == 422


def test_predict_invalid_hex_in_target_palette_returns_422(client: TestClient):
    """POST /predict with invalid hex in target_palette returns 422. Validates: Requirements 9.4"""
    payload = {
        "source_palette": VALID_PALETTE,
        "target_palette": ["#ff0000", "notahex", "#0000ff", "#ffffff"],
        "source_features": VALID_FEATURES,
    }
    response = client.post("/predict", json=payload)
    assert response.status_code == 422


def test_predict_hex_without_hash_returns_422(client: TestClient):
    """POST /predict with hex missing '#' prefix returns 422."""
    payload = {
        "source_palette": ["ff0000", "#00ff00", "#0000ff", "#ffffff"],
        "target_palette": VALID_PALETTE,
        "source_features": VALID_FEATURES,
    }
    response = client.post("/predict", json=payload)
    assert response.status_code == 422


def test_predict_wrong_palette_length_returns_422(client: TestClient):
    """POST /predict with palette of wrong length returns 422. Validates: Requirements 9.4"""
    payload = {
        "source_palette": ["#ff0000", "#00ff00", "#0000ff"],  # only 3 colors
        "target_palette": VALID_PALETTE,
        "source_features": VALID_FEATURES,
    }
    response = client.post("/predict", json=payload)
    assert response.status_code == 422


def test_predict_wrong_feature_vector_length_returns_422(client: TestClient):
    """POST /predict with source_features of wrong length returns 422. Validates: Requirements 9.4"""
    payload = {
        "source_palette": VALID_PALETTE,
        "target_palette": VALID_PALETTE,
        "source_features": [0.5, 0.1, 0.5],  # only 3 elements
    }
    response = client.post("/predict", json=payload)
    assert response.status_code == 422


def test_predict_valid_request_returns_200(client: TestClient):
    """POST /predict with a valid request returns 200 with oklch list."""
    import inference.main as main_module
    main_module._mapper = _make_mock_mapper(L=0.6, C=0.15, H_norm=0.25)

    payload = {
        "source_palette": VALID_PALETTE,
        "target_palette": VALID_PALETTE,
        "source_features": VALID_FEATURES,
    }
    response = client.post("/predict", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "oklch" in data
    assert len(data["oklch"]) == 3


def test_predict_h_converted_to_degrees(client: TestClient):
    """POST /predict response H is in degrees (0-360), not normalized [0-1]."""
    import inference.main as main_module
    # H_norm = 0.5 → H_deg should be 180.0
    main_module._mapper = _make_mock_mapper(L=0.5, C=0.1, H_norm=0.5)

    payload = {
        "source_palette": VALID_PALETTE,
        "target_palette": VALID_PALETTE,
        "source_features": VALID_FEATURES,
    }
    response = client.post("/predict", json=payload)
    assert response.status_code == 200
    _, _, H = response.json()["oklch"]
    assert abs(H - 180.0) < 1e-4, f"Expected H≈180.0, got {H}"
