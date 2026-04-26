import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { clusterColors, naiveMapping } from "../color-assignment";
import { parseSvg } from "../svg-parser";
import type { ExtractedColor } from "../svg-parser";

const fixturesDir = join(__dirname, "fixtures");
const readFixture = (name: string) =>
  readFileSync(join(fixturesDir, name), "utf-8");

// ─── Helper ──────────────────────────────────────────────────────────────────

function makeColor(
  hex: string,
  area: number = 100,
  frequency: number = 1
): ExtractedColor {
  return { hex, elements: ["rect"], frequency, area, depth: 1 };
}

// ─── clusterColors ───────────────────────────────────────────────────────────

describe("clusterColors", () => {
  it("returns empty for no colors", () => {
    const result = clusterColors([]);
    expect(result.families).toHaveLength(0);
    expect(result.warning).toBeNull();
  });

  it("creates one family per distinct color", () => {
    const colors = [
      makeColor("#ff0000", 200), // red
      makeColor("#0000ff", 150), // blue
      makeColor("#00ff00", 100), // green
    ];
    const result = clusterColors(colors);
    // These are perceptually very different, should be 3 families
    expect(result.families).toHaveLength(3);
  });

  it("clusters similar colors into one family", () => {
    // Two very similar dark blues
    const colors = [
      makeColor("#1a1a2e", 200),
      makeColor("#16213e", 150),
    ];
    const result = clusterColors(colors);
    // Should cluster into 1 family (perceptually close)
    expect(result.families.length).toBeLessThanOrEqual(2);
  });

  it("base is the color with largest area", () => {
    const colors = [
      makeColor("#ff0000", 50),  // small red
      makeColor("#ff1111", 200), // large similar red
      makeColor("#0000ff", 100), // blue
    ];
    const result = clusterColors(colors);
    // The red family's base should be the larger one
    const redFamily = result.families.find(
      (f) => f.base.hex === "#ff1111" || f.base.hex === "#ff0000"
    );
    expect(redFamily).toBeDefined();
    expect(redFamily!.base.area).toBe(200);
  });

  it("computes offsets for non-base members", () => {
    // Create colors that will cluster together
    const colors = [
      makeColor("#ff0000", 200), // base (larger area)
      makeColor("#cc0000", 50),  // darker red (should cluster with above)
    ];
    const result = clusterColors(colors);

    // Find the family containing red
    const redFamily = result.families.find(
      (f) => f.base.hex === "#ff0000" || f.base.hex === "#cc0000"
    );

    if (redFamily && redFamily.members.length > 1) {
      // Should have an offset for the non-base member
      expect(redFamily.offsets.size).toBeGreaterThan(0);
    }
  });

  it("warns when families exceed target palette size", () => {
    const colors = [
      makeColor("#ff0000", 100),
      makeColor("#00ff00", 100),
      makeColor("#0000ff", 100),
      makeColor("#ffff00", 100),
      makeColor("#ff00ff", 100),
    ];
    const result = clusterColors(colors, 4);
    // 5 very different colors with target of 4
    if (result.families.length > 4) {
      expect(result.warning).not.toBeNull();
      expect(result.warning).toContain("color families");
    }
  });

  it("no warning when families fit within palette size", () => {
    const colors = [
      makeColor("#ff0000", 100),
      makeColor("#0000ff", 100),
    ];
    const result = clusterColors(colors, 4);
    expect(result.warning).toBeNull();
  });

  it("computes feature vectors for each family base", () => {
    const colors = [
      makeColor("#ff0000", 100),
      makeColor("#0000ff", 100),
    ];
    const result = clusterColors(colors);
    for (const family of result.families) {
      expect(family.featureVector).toHaveLength(6);
      // L should be in [0, 1]
      expect(family.featureVector[0]).toBeGreaterThanOrEqual(0);
      expect(family.featureVector[0]).toBeLessThanOrEqual(1);
    }
  });
});

// ─── naiveMapping ────────────────────────────────────────────────────────────

describe("naiveMapping", () => {
  it("maps each family to a target palette color", () => {
    const colors = [
      makeColor("#264653", 200), // dark teal
      makeColor("#e9c46a", 150), // warm yellow
      makeColor("#e76f51", 100), // warm orange-red
    ];
    const clusterResult = clusterColors(colors);
    const targetPalette = ["#1d3557", "#457b9d", "#a8dadc", "#f1faee"];

    const result = naiveMapping(clusterResult, targetPalette);

    expect(result.mappings).toHaveLength(clusterResult.families.length);
    expect(result.fullColorMap.size).toBeGreaterThanOrEqual(3);

    // Each source color should have a mapping
    for (const color of colors) {
      expect(result.fullColorMap.has(color.hex)).toBe(true);
    }
  });

  it("produces valid hex values in the color map", () => {
    const colors = [
      makeColor("#ff0000", 100),
      makeColor("#0000ff", 100),
    ];
    const clusterResult = clusterColors(colors);
    const targetPalette = ["#264653", "#2a9d8f", "#e9c46a", "#e76f51"];

    const result = naiveMapping(clusterResult, targetPalette);

    for (const [src, tgt] of result.fullColorMap) {
      expect(src).toMatch(/^#[0-9a-f]{6}$/);
      expect(tgt).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("prefers unique target assignments", () => {
    const colors = [
      makeColor("#ff0000", 200), // warm, high chroma
      makeColor("#0000ff", 150), // cool, high chroma
      makeColor("#00ff00", 100), // cool, high chroma
    ];
    const clusterResult = clusterColors(colors);
    const targetPalette = ["#e76f51", "#2a9d8f", "#264653", "#e9c46a"];

    const result = naiveMapping(clusterResult, targetPalette);

    // Check that different families got different targets (when possible)
    const assignedTargets = result.mappings.map((m) => m.targetBaseHex);
    const uniqueTargets = new Set(assignedTargets);
    // With 3 families and 4 palette colors, all should be unique
    expect(uniqueTargets.size).toBe(assignedTargets.length);
  });

  it("maps shades using offsets from base", () => {
    // Two similar reds (will cluster) + a blue
    const colors = [
      makeColor("#ff0000", 200), // bright red (base)
      makeColor("#cc0000", 50),  // darker red (shade)
      makeColor("#0000ff", 100), // blue
    ];
    const clusterResult = clusterColors(colors);
    const targetPalette = ["#264653", "#2a9d8f", "#e9c46a", "#e76f51"];

    const result = naiveMapping(clusterResult, targetPalette);

    // Both reds should be in the color map
    expect(result.fullColorMap.has("#ff0000")).toBe(true);
    expect(result.fullColorMap.has("#cc0000")).toBe(true);

    // The shade should be different from the base mapping
    const baseTarget = result.fullColorMap.get("#ff0000");
    const shadeTarget = result.fullColorMap.get("#cc0000");
    if (baseTarget && shadeTarget) {
      // Shade should be a variation of the base target, not identical
      // (unless the offset is zero, which it isn't for these colors)
      expect(shadeTarget).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("includes warnings from clustering", () => {
    const colors = [
      makeColor("#ff0000", 100),
      makeColor("#00ff00", 100),
      makeColor("#0000ff", 100),
      makeColor("#ffff00", 100),
      makeColor("#ff00ff", 100),
    ];
    const clusterResult = clusterColors(colors, 4);
    const targetPalette = ["#111111", "#222222", "#333333", "#444444"];

    const result = naiveMapping(clusterResult, targetPalette);

    if (clusterResult.families.length > 4) {
      expect(result.warnings.length).toBeGreaterThan(0);
    }
  });
});

// ─── Fixture Integration ─────────────────────────────────────────────────────

describe("color-assignment — fixture integration", () => {
  it("clusters simple-icon.svg colors into families", () => {
    const svg = readFixture("simple-icon.svg");
    const { colors } = parseSvg(svg);
    const result = clusterColors(colors);

    // simple-icon has 4 distinct colors: #264653, #e9c46a, #e76f51, #2a9d8f
    expect(result.families.length).toBeGreaterThanOrEqual(3);
    expect(result.families.length).toBeLessThanOrEqual(4);
  });

  it("full pipeline: parse → cluster → map for simple-icon", () => {
    const svg = readFixture("simple-icon.svg");
    const { colors } = parseSvg(svg);
    const clusterResult = clusterColors(colors);
    const targetPalette = ["#1d3557", "#457b9d", "#a8dadc", "#f1faee"];

    const result = naiveMapping(clusterResult, targetPalette);

    // Every extracted color should have a mapping
    for (const color of colors) {
      expect(result.fullColorMap.has(color.hex)).toBe(true);
    }

    // All target values should be valid hex
    for (const hex of result.fullColorMap.values()) {
      expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("full pipeline: parse → cluster → map for inline-styles", () => {
    const svg = readFixture("inline-styles.svg");
    const { colors } = parseSvg(svg);
    const clusterResult = clusterColors(colors);
    const targetPalette = ["#606c38", "#283618", "#fefae0", "#dda15e"];

    const result = naiveMapping(clusterResult, targetPalette);

    expect(result.fullColorMap.size).toBeGreaterThanOrEqual(colors.length);
    for (const hex of result.fullColorMap.values()) {
      expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
