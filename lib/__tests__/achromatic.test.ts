import { describe, it, expect } from "vitest";
import { hexToOklch, isAchromatic, ACHROMATIC_THRESHOLD } from "../color-math";
import { clusterColors, naiveMapping } from "../color-assignment";
import { parseSvg } from "../svg-parser";
import { recolorSvg } from "../svg-rewriter";
import type { ExtractedColor } from "../svg-parser";
import type { ColorMap } from "../svg-rewriter";

function makeColor(hex: string, area = 100): ExtractedColor {
  return { hex, elements: ["rect"], frequency: 1, area, depth: 1 };
}

// ─── isAchromatic ────────────────────────────────────────────────────────────

describe("isAchromatic", () => {
  it("detects pure black as achromatic", () => {
    expect(isAchromatic(hexToOklch("#000000"))).toBe(true);
  });

  it("detects pure white as achromatic", () => {
    expect(isAchromatic(hexToOklch("#ffffff"))).toBe(true);
  });

  it("detects mid-grey as achromatic", () => {
    expect(isAchromatic(hexToOklch("#808080"))).toBe(true);
  });

  it("detects light grey as achromatic", () => {
    expect(isAchromatic(hexToOklch("#cccccc"))).toBe(true);
  });

  it("detects dark grey as achromatic", () => {
    expect(isAchromatic(hexToOklch("#333333"))).toBe(true);
  });

  it("does NOT flag saturated red as achromatic", () => {
    expect(isAchromatic(hexToOklch("#ff0000"))).toBe(false);
  });

  it("does NOT flag saturated blue as achromatic", () => {
    expect(isAchromatic(hexToOklch("#0000ff"))).toBe(false);
  });

  it("does NOT flag a teal as achromatic", () => {
    expect(isAchromatic(hexToOklch("#2a9d8f"))).toBe(false);
  });

  it("uses threshold of 0.05", () => {
    expect(ACHROMATIC_THRESHOLD).toBe(0.05);
  });
});

// ─── clusterColors — achromatic separation ───────────────────────────────────

describe("clusterColors — achromatic filtering", () => {
  it("separates black from chromatic colors", () => {
    const colors = [
      makeColor("#ff0000", 200),
      makeColor("#000000", 100),
      makeColor("#0000ff", 150),
    ];
    const result = clusterColors(colors);
    expect(result.achromaticColors.map((c) => c.hex)).toContain("#000000");
    expect(result.families.every((f) => f.base.hex !== "#000000")).toBe(true);
  });

  it("separates white from chromatic colors", () => {
    const colors = [
      makeColor("#ff0000", 200),
      makeColor("#ffffff", 300),
    ];
    const result = clusterColors(colors);
    expect(result.achromaticColors.map((c) => c.hex)).toContain("#ffffff");
    expect(result.families).toHaveLength(1);
  });

  it("separates multiple greys", () => {
    const colors = [
      makeColor("#ff0000", 200),
      makeColor("#808080", 100),
      makeColor("#cccccc", 50),
      makeColor("#333333", 50),
    ];
    const result = clusterColors(colors);
    expect(result.achromaticColors).toHaveLength(3);
    expect(result.families).toHaveLength(1);
  });

  it("handles all-achromatic SVG", () => {
    const colors = [
      makeColor("#000000", 200),
      makeColor("#ffffff", 100),
      makeColor("#808080", 50),
    ];
    const result = clusterColors(colors);
    expect(result.families).toHaveLength(0);
    expect(result.achromaticColors).toHaveLength(3);
  });

  it("handles no achromatic colors", () => {
    const colors = [
      makeColor("#ff0000", 200),
      makeColor("#0000ff", 150),
    ];
    const result = clusterColors(colors);
    expect(result.achromaticColors).toHaveLength(0);
    expect(result.families.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── naiveMapping — achromatic passthrough ───────────────────────────────────

describe("naiveMapping — achromatic passthrough", () => {
  it("maps achromatic colors to themselves", () => {
    const colors = [
      makeColor("#ff0000", 200),
      makeColor("#000000", 100),
      makeColor("#ffffff", 50),
    ];
    const clusterResult = clusterColors(colors);
    const result = naiveMapping(clusterResult, ["#264653", "#2a9d8f", "#e9c46a", "#e76f51"]);

    expect(result.fullColorMap.get("#000000")).toBe("#000000");
    expect(result.fullColorMap.get("#ffffff")).toBe("#ffffff");
  });

  it("still maps chromatic colors to target palette", () => {
    const colors = [
      makeColor("#ff0000", 200),
      makeColor("#000000", 100),
    ];
    const clusterResult = clusterColors(colors);
    const result = naiveMapping(clusterResult, ["#264653", "#2a9d8f", "#e9c46a", "#e76f51"]);

    // Red should be mapped to something in the target palette
    expect(result.fullColorMap.get("#ff0000")).not.toBe("#ff0000");
    // Black stays black
    expect(result.fullColorMap.get("#000000")).toBe("#000000");
  });
});

// ─── End-to-end: SVG with achromatic colors ──────────────────────────────────

describe("end-to-end — achromatic preservation in SVG", () => {
  it("preserves black and white in recolored SVG", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <rect fill="#ff0000" width="100" height="100"/>
      <rect fill="#000000" width="50" height="50"/>
      <text fill="#ffffff" x="10" y="10">Hello</text>
    </svg>`;
    const { colors } = parseSvg(svg);
    const clusterResult = clusterColors(colors);
    const mapping = naiveMapping(clusterResult, ["#264653", "#2a9d8f", "#e9c46a", "#e76f51"]);
    const result = recolorSvg(svg, mapping.fullColorMap);

    // Black and white should still be in the output
    expect(result).toContain("#000000");
    expect(result).toContain("#ffffff");
    // Red should be remapped
    expect(result).not.toContain("#ff0000");
  });

  it("preserves grey in recolored SVG", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <rect fill="#2a9d8f" width="100" height="100"/>
      <rect fill="#808080" width="50" height="50"/>
    </svg>`;
    const { colors } = parseSvg(svg);
    const clusterResult = clusterColors(colors);
    const mapping = naiveMapping(clusterResult, ["#ff0000", "#00ff00", "#0000ff", "#ffff00"]);
    const result = recolorSvg(svg, mapping.fullColorMap);

    expect(result).toContain("#808080");
    expect(result).not.toContain("#2a9d8f");
  });
});
