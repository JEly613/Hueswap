"""Unit tests for ml/scrape.py — palette scraper.

Tests cover:
- Network error handling (logs error, continues)
- Invalid palette size skipping
- Invalid hex format validation and skipping
- Valid palette storage format

Requirements: 1.4, 1.5, 1.6
"""

import json
import logging
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from ml.scrape import (
    fetch_page,
    parse_palette_code,
    save_palette,
    scrape_palettes,
    validate_palette,
)


# ---------------------------------------------------------------------------
# parse_palette_code
# ---------------------------------------------------------------------------

class TestParsePaletteCode:
    def test_valid_24char_code(self):
        code = "e8d5b7b8860b556b2f2f4f4f"
        result = parse_palette_code(code)
        assert result == ["#e8d5b7", "#b8860b", "#556b2f", "#2f4f4f"]

    def test_short_code_returns_none(self):
        assert parse_palette_code("aabbcc") is None

    def test_long_code_returns_none(self):
        assert parse_palette_code("a" * 30) is None

    def test_empty_string_returns_none(self):
        assert parse_palette_code("") is None

    def test_non_string_returns_none(self):
        assert parse_palette_code(12345) is None
        assert parse_palette_code(None) is None


# ---------------------------------------------------------------------------
# validate_palette
# ---------------------------------------------------------------------------

class TestValidatePalette:
    """Requirement 1.5: palettes with != 4 colors are skipped with warning.
    Requirement 1.6: invalid hex format causes palette to be skipped."""

    def test_valid_palette(self):
        colors = ["#aabbcc", "#112233", "#445566", "#778899"]
        assert validate_palette(colors) is True

    def test_too_few_colors_skipped(self, caplog):
        with caplog.at_level(logging.WARNING):
            assert validate_palette(["#aabbcc", "#112233"]) is False
        assert "2 colors instead of 4" in caplog.text

    def test_too_many_colors_skipped(self, caplog):
        colors = ["#aabbcc"] * 5
        with caplog.at_level(logging.WARNING):
            assert validate_palette(colors) is False
        assert "5 colors instead of 4" in caplog.text

    def test_empty_list_skipped(self, caplog):
        with caplog.at_level(logging.WARNING):
            assert validate_palette([]) is False

    def test_invalid_hex_no_hash(self, caplog):
        colors = ["aabbcc", "#112233", "#445566", "#778899"]
        with caplog.at_level(logging.WARNING):
            assert validate_palette(colors) is False
        assert "Invalid hex color" in caplog.text

    def test_invalid_hex_short(self, caplog):
        colors = ["#abc", "#112233", "#445566", "#778899"]
        with caplog.at_level(logging.WARNING):
            assert validate_palette(colors) is False
        assert "Invalid hex color" in caplog.text

    def test_invalid_hex_non_hex_chars(self, caplog):
        colors = ["#gghhii", "#112233", "#445566", "#778899"]
        with caplog.at_level(logging.WARNING):
            assert validate_palette(colors) is False
        assert "Invalid hex color" in caplog.text

    def test_uppercase_hex_valid(self):
        colors = ["#AABBCC", "#112233", "#445566", "#778899"]
        assert validate_palette(colors) is True

    def test_mixed_case_hex_valid(self):
        colors = ["#AaBbCc", "#112233", "#445566", "#778899"]
        assert validate_palette(colors) is True


# ---------------------------------------------------------------------------
# fetch_page — network error handling
# ---------------------------------------------------------------------------

class TestFetchPage:
    """Requirement 1.4: network errors are logged and scraping continues."""

    @patch("ml.scrape.requests.post")
    def test_successful_fetch(self, mock_post):
        mock_resp = MagicMock()
        mock_resp.json.return_value = [{"code": "aabbccddeeff11223344"}]
        mock_resp.raise_for_status = MagicMock()
        mock_post.return_value = mock_resp
        result = fetch_page(0, "new")
        assert result == [{"code": "aabbccddeeff11223344"}]

    @patch("ml.scrape.requests.post")
    def test_non_list_response_returns_empty(self, mock_post):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"error": "bad"}
        mock_resp.raise_for_status = MagicMock()
        mock_post.return_value = mock_resp
        assert fetch_page(0, "new") == []

    @patch("ml.scrape.requests.post")
    def test_network_error_raises(self, mock_post):
        import requests
        mock_post.side_effect = requests.RequestException("timeout")
        with pytest.raises(requests.RequestException):
            fetch_page(0, "new")


# ---------------------------------------------------------------------------
# save_palette — valid palette storage format
# ---------------------------------------------------------------------------

class TestSavePalette:
    """Valid palettes are stored in correct JSON format."""

    def test_writes_correct_json(self, tmp_path):
        colors = ["#e8d5b7", "#b8860b", "#556b2f", "#2f4f4f"]
        filepath = save_palette(colors, tmp_path, 0)
        assert filepath == tmp_path / "palette_0000.json"
        with open(filepath) as f:
            data = json.load(f)
        assert data == {"colors": colors}

    def test_filename_zero_padded(self, tmp_path):
        colors = ["#aabbcc", "#112233", "#445566", "#778899"]
        path = save_palette(colors, tmp_path, 42)
        assert path.name == "palette_0042.json"

    def test_json_has_indent(self, tmp_path):
        colors = ["#aabbcc", "#112233", "#445566", "#778899"]
        save_palette(colors, tmp_path, 0)
        raw = (tmp_path / "palette_0000.json").read_text()
        # indented JSON has newlines
        assert "\n" in raw


# ---------------------------------------------------------------------------
# scrape_palettes — end-to-end integration with mocked network
# ---------------------------------------------------------------------------

class TestScrapePalettes:
    """Integration-level tests for the main scrape loop."""

    def _make_page(self, codes: list[str]) -> list[dict]:
        return [{"code": c} for c in codes]

    @patch("ml.scrape.time.sleep")  # skip delays
    @patch("ml.scrape.fetch_page")
    def test_network_error_logged_and_continues(
        self, mock_fetch, mock_sleep, tmp_path, caplog
    ):
        """Req 1.4: network error → log error, continue scraping."""
        import requests as req

        valid_code = "e8d5b7b8860b556b2f2f4f4f"
        # First call raises, second returns valid data, third returns empty
        mock_fetch.side_effect = [
            req.RequestException("connection refused"),
            self._make_page([valid_code]),
            [],
        ]
        with caplog.at_level(logging.ERROR):
            count = scrape_palettes(
                target=1, output_dir=tmp_path, sort_orders=["new"]
            )
        assert count == 1
        assert "Network error" in caplog.text

    @patch("ml.scrape.time.sleep")
    @patch("ml.scrape.fetch_page")
    def test_invalid_palette_size_skipped(
        self, mock_fetch, mock_sleep, tmp_path, caplog
    ):
        """Req 1.5: palette with != 4 colors is skipped."""
        # 12-char code → only 2 colors parsed (None from parse_palette_code)
        short_code = "aabbccddeeff"  # 12 chars → parse returns None
        valid_code = "e8d5b7b8860b556b2f2f4f4f"
        mock_fetch.side_effect = [
            self._make_page([short_code, valid_code]),
            [],
        ]
        with caplog.at_level(logging.WARNING):
            count = scrape_palettes(
                target=1, output_dir=tmp_path, sort_orders=["new"]
            )
        assert count == 1
        assert "Could not parse palette code" in caplog.text

    @patch("ml.scrape.time.sleep")
    @patch("ml.scrape.fetch_page")
    def test_invalid_hex_format_skipped(
        self, mock_fetch, mock_sleep, tmp_path, caplog
    ):
        """Req 1.6: invalid hex chars in palette → skip with warning."""
        # 24 chars but contains non-hex 'gg' → validate_palette rejects
        bad_code = "gghhiijjkkll112233445566"
        valid_code = "e8d5b7b8860b556b2f2f4f4f"
        mock_fetch.side_effect = [
            self._make_page([bad_code, valid_code]),
            [],
        ]
        with caplog.at_level(logging.WARNING):
            count = scrape_palettes(
                target=1, output_dir=tmp_path, sort_orders=["new"]
            )
        assert count == 1
        assert "Invalid hex color" in caplog.text

    @patch("ml.scrape.time.sleep")
    @patch("ml.scrape.fetch_page")
    def test_valid_palette_stored_correctly(
        self, mock_fetch, mock_sleep, tmp_path
    ):
        """Valid palettes are saved as JSON with correct format."""
        code = "e8d5b7b8860b556b2f2f4f4f"
        mock_fetch.side_effect = [self._make_page([code]), []]
        count = scrape_palettes(
            target=1, output_dir=tmp_path, sort_orders=["new"]
        )
        assert count == 1
        fp = tmp_path / "palette_0000.json"
        assert fp.exists()
        data = json.load(open(fp))
        assert data == {
            "colors": ["#e8d5b7", "#b8860b", "#556b2f", "#2f4f4f"]
        }

    @patch("ml.scrape.time.sleep")
    @patch("ml.scrape.fetch_page")
    def test_deduplicates_palettes(self, mock_fetch, mock_sleep, tmp_path):
        """Same palette code seen twice → only saved once."""
        code = "e8d5b7b8860b556b2f2f4f4f"
        mock_fetch.side_effect = [
            self._make_page([code, code]),
            [],  # empty streak 1
            [],  # empty streak 2
            [],  # empty streak 3 → stops
        ]
        count = scrape_palettes(
            target=5, output_dir=tmp_path, sort_orders=["new"]
        )
        assert count == 1

    @patch("ml.scrape.time.sleep")
    @patch("ml.scrape.fetch_page")
    def test_stops_at_target(self, mock_fetch, mock_sleep, tmp_path):
        """Scraping stops once target count is reached."""
        codes = [f"{i:06x}" * 4 for i in range(10)]
        mock_fetch.side_effect = [self._make_page(codes), []]
        count = scrape_palettes(
            target=3, output_dir=tmp_path, sort_orders=["new"]
        )
        assert count == 3

    @patch("ml.scrape.time.sleep")
    @patch("ml.scrape.fetch_page")
    def test_creates_output_dir(self, mock_fetch, mock_sleep, tmp_path):
        """Output directory is created if it doesn't exist."""
        out = tmp_path / "nested" / "dir"
        mock_fetch.side_effect = [
            [],  # empty streak 1
            [],  # empty streak 2
            [],  # empty streak 3 → stops
        ]
        scrape_palettes(target=1, output_dir=out, sort_orders=["new"])
        assert out.is_dir()
