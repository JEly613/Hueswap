import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { parseSvg, extractColors } from "../svg-parser";
import { clusterColors, naiveMapping } from "../color-assignment";
import { recolorSvg } from "../svg-rewriter";

const fixturesDir = join(__dirname, "fixtures");
const readFixture = (name: string) =>
  readFileSync(join(fixturesDir, name), "utf-8");

/**
 * Full pipeline: SVG string + target palette → recolored SVG
 * Mirrors what app/api/recolor/route.ts does.
 */
function runPipeline(svgString: string, targetPalette: string[]) {
  const { colors } = parseSvg(svgString);
  const clusterResult = clusterColors(colors, targetPalette.length);
  const mappingResult = naiveMapping(clusterResult, targetPalette);
  const recoloredSvg = recolorSvg(svgString, mappingResult.fullColorMap);
  return { colors, clusterResult, mappingResult, recoloredSvg };
}

// ─── End-to-End Pipeline Tests ───────────────────────────────────────────────

describe("full pipeline — simple-icon.svg", () => {
  const svg = readFixture("simple-icon.svg");
  const targetPalette = ["#1d3557", "#457b9d", "#a8dadc", "#f1faee"];

  it("extracts colors, clusters, maps, and rewrites", () => {
    const { colors, clusterResult, mappingResult, recoloredSvg } =
      runPipeline(svg, targetPalette);

    // Colors extracted
    expect(colors.length).toBeGreaterThanOrEqual(3);

    // Families formed
    expect(clusterResult.families.length).toBeGreaterThanOrEqual(3);

    // All source colors mapped
    for (const color of colors) {
      expect(mappingResult.fullColorMap.has(color.hex)).toBe(true);
    }

    // Recolored SVG contains target palette colors
    const recoloredColors = extractColors(recoloredSvg);
    expect(recoloredColors.length).toBeGreaterThan(0);

    // Original colors should be gone
    for (const color of colors) {
      expect(recoloredSvg).not.toContain(color.hex);
    }
  });

  it("recolored SVG is valid (re-parseable)", () => {
    const { recoloredSvg } = runPipeline(svg, targetPalette);
    // Should not throw
    const { colors } = parseSvg(recoloredSvg);
    expect(colors.length).toBeGreaterThan(0);
  });
});

describe("full pipeline — inline-styles.svg", () => {
  const svg = readFixture("inline-styles.svg");
  const targetPalette = ["#606c38", "#283618", "#fefae0", "#dda15e"];

  it("handles inline-style SVGs end-to-end", () => {
    const { colors, mappingResult, recoloredSvg } = runPipeline(
      svg,
      targetPalette
    );

    expect(colors.length).toBeGreaterThanOrEqual(4);
    expect(mappingResult.fullColorMap.size).toBeGreaterThanOrEqual(4);

    // Recolored SVG should have new colors
    const recoloredColors = extractColors(recoloredSvg);
    expect(recoloredColors.length).toBeGreaterThan(0);
  });
});

describe("full pipeline — gradient-badge.svg", () => {
  const svg = readFixture("gradient-badge.svg");
  const targetPalette = ["#ef4444", "#f97316", "#eab308", "#22c55e"];

  it("handles gradients and url() refs", () => {
    const { colors, recoloredSvg } = runPipeline(svg, targetPalette);

    expect(colors.length).toBeGreaterThanOrEqual(3);

    // url() references should be preserved
    expect(recoloredSvg).toContain("url(#bg)");
    expect(recoloredSvg).toContain("url(#shine)");

    // fill="none" preserved
    expect(recoloredSvg).toContain("none");
  });
});

describe("full pipeline — edge cases", () => {
  it("handles SVG with no colors gracefully", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>`;
    const { colors, recoloredSvg } = runPipeline(svg, ["#ff0000"]);
    expect(colors).toHaveLength(0);
    expect(recoloredSvg).toContain("rect");
  });

  it("handles single-color SVG", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#ff0000" width="10" height="10"/></svg>`;
    const { mappingResult, recoloredSvg } = runPipeline(svg, [
      "#264653",
      "#2a9d8f",
      "#e9c46a",
      "#e76f51",
    ]);
    expect(mappingResult.fullColorMap.size).toBe(1);
    expect(recoloredSvg).not.toContain("#ff0000");
  });

  it("handles palette with 1 color", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <rect fill="#ff0000" width="10" height="10"/>
      <circle fill="#0000ff" r="5" cx="5" cy="5"/>
    </svg>`;
    const { mappingResult } = runPipeline(svg, ["#333333"]);
    // Both colors should map to the single target (or shades of it)
    expect(mappingResult.fullColorMap.size).toBe(2);
  });
});
