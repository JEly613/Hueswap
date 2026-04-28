"""Colorhunt.co palette scraper.

Fetches color palettes from colorhunt.co and writes them as individual
JSON files to ml/data/raw/. Each file contains exactly 4 validated hex colors.

Usage:
    python ml/scrape.py
"""

import json
import logging
import re
import time
from pathlib import Path
from typing import Optional

import requests

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)

HEX_PATTERN = re.compile(r"^#[0-9a-fA-F]{6}$")
FEED_URL = "https://colorhunt.co/php/feed.php"
OUTPUT_DIR = Path(__file__).resolve().parent / "data" / "raw"
TARGET_PALETTES = 500
PALETTES_PER_PAGE = 40  # approx items per page from colorhunt
REQUEST_DELAY = 1.0  # seconds between requests to be polite


def parse_palette_code(code: str) -> Optional[list[str]]:
    """Parse a colorhunt palette code into a list of 4 hex color strings.

    Args:
        code: A 24-character hex string representing 4 concatenated colors.

    Returns:
        A list of 4 hex color strings (e.g. ['#aabbcc', ...]) or None if invalid.
    """
    if not isinstance(code, str) or len(code) != 24:
        return None
    colors = [f"#{code[i:i+6]}" for i in range(0, 24, 6)]
    return colors


def validate_palette(colors: list[str]) -> bool:
    """Validate that a palette has exactly 4 valid hex colors.

    Args:
        colors: List of hex color strings to validate.

    Returns:
        True if the palette has exactly 4 colors, each matching #[0-9a-fA-F]{6}.
    """
    if len(colors) != 4:
        logger.warning("Palette has %d colors instead of 4, skipping", len(colors))
        return False
    for color in colors:
        if not HEX_PATTERN.match(color):
            logger.warning("Invalid hex color '%s', skipping palette", color)
            return False
    return True


def fetch_page(step: int, sort: str = "new") -> list[dict]:
    """Fetch a single page of palettes from colorhunt.co.

    Args:
        step: Page number (0-indexed) for pagination.
        sort: Sort order — 'new', 'popular', 'random', or 'trendy'.

    Returns:
        List of palette dicts from the API response.

    Raises:
        requests.RequestException: On network errors (caught by caller).
    """
    response = requests.post(
        FEED_URL,
        data={"step": step, "sort": sort, "tags": ""},
        headers={"Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"},
        timeout=30,
    )
    response.raise_for_status()
    data = response.json()
    if not isinstance(data, list):
        return []
    return data


def save_palette(colors: list[str], output_dir: Path, index: int) -> Path:
    """Write a validated palette to a JSON file.

    Args:
        colors: List of 4 hex color strings.
        output_dir: Directory to write the JSON file to.
        index: Numeric index used in the filename.

    Returns:
        Path to the written file.
    """
    filepath = output_dir / f"palette_{index:04d}.json"
    with open(filepath, "w") as f:
        json.dump({"colors": colors}, f, indent=2)
    return filepath


def scrape_palettes(
    target: int = TARGET_PALETTES,
    output_dir: Path = OUTPUT_DIR,
    sort_orders: Optional[list[str]] = None,
) -> int:
    """Scrape palettes from colorhunt.co and save them as individual JSON files.

    Fetches palettes using multiple sort orders to maximize unique results.
    Handles network errors gracefully by logging and continuing.

    Args:
        target: Minimum number of palettes to collect.
        output_dir: Directory to write palette JSON files to.
        sort_orders: List of sort orders to cycle through.

    Returns:
        Total number of palettes saved.
    """
    if sort_orders is None:
        sort_orders = ["popular", "new", "trendy", "random"]

    output_dir.mkdir(parents=True, exist_ok=True)

    seen_codes: set[str] = set()
    saved_count = 0
    max_empty_pages = 3  # stop a sort order after N consecutive empty pages

    for sort in sort_orders:
        if saved_count >= target:
            break

        logger.info("Fetching '%s' palettes...", sort)
        empty_streak = 0
        step = 0

        while saved_count < target and empty_streak < max_empty_pages:
            url_desc = f"{FEED_URL} (sort={sort}, step={step})"
            try:
                page = fetch_page(step, sort)
            except requests.RequestException as exc:
                logger.error("Network error fetching %s: %s", url_desc, exc)
                step += 1
                empty_streak += 1
                time.sleep(REQUEST_DELAY)
                continue

            if not page:
                empty_streak += 1
                step += 1
                time.sleep(REQUEST_DELAY)
                continue

            new_on_page = 0
            for entry in page:
                code = entry.get("code", "")
                if code in seen_codes:
                    continue

                colors = parse_palette_code(code)
                if colors is None:
                    logger.warning(
                        "Could not parse palette code '%s', skipping", code[:30]
                    )
                    continue

                if not validate_palette(colors):
                    continue

                seen_codes.add(code)
                save_palette(colors, output_dir, saved_count)
                saved_count += 1
                new_on_page += 1

                if saved_count >= target:
                    break

            if new_on_page == 0:
                empty_streak += 1
            else:
                empty_streak = 0

            step += 1
            logger.info(
                "  step=%d: %d new palettes (total: %d/%d)",
                step - 1,
                new_on_page,
                saved_count,
                target,
            )
            time.sleep(REQUEST_DELAY)

    logger.info("Scraping complete. Saved %d palettes to %s", saved_count, output_dir)
    return saved_count


def main() -> None:
    """Entry point for standalone execution."""
    count = scrape_palettes()
    if count < TARGET_PALETTES:
        logger.warning(
            "Only scraped %d palettes (target was %d). "
            "Consider running again or adjusting sort orders.",
            count,
            TARGET_PALETTES,
        )


if __name__ == "__main__":
    main()
