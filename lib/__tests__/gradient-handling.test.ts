import { describe, it, expect } from "vitest";
import { parseSvg } from "../svg-parser";
import { recolorSvg } from "../svg-rewriter";
import { hexToOklch } from "../color-math";
import type { ColorMap } from "../svg-rewriter";

// ─── svg-parser: gradient extraction ─────────────────────────────────────────

describe("parseSvg — gradient stop extraction", () => {
  it("extracts linearGradient stops as independent colors", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g1">
          <stop offset="0%" stop-color="#ff0000"/>
          <stop offset="50%" stop-color="#00ff00"/>
          <stop offset="100%" stop-color="#0000ff"/>
        </linearGradient>
      </defs>
    </svg>`;
    const { colors, gradients } = parseSvg(svg);
    const hexes = colors.map((c) => c.hex);
    expect(hexes).toContain("#ff0000");
    expect(hexes).toContain("#00ff00");
    expect(hexes).toContain("#0000ff");

    // Gradient metadata
    expect(gradients).toHaveLength(1);
    expect(gradients[0].id).toBe("g1");
    expect(gradients[0].type).toBe("linearGradient");
    expect(gradients[0].stops).toHaveLength(3);
    expect(gradients[0].stops[0]).toEqual({ offset: 0, hex: "#ff0000" });
    expect(gradients[0].stops[1]).toEqual({ offset: 0.5, hex: "#00ff00" });
    expect(gradients[0].stops[2]).toEqual({ offset: 1, hex: "#0000ff" });
  });

  it("extracts radialGradient stops", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="rg">
          <stop offset="0%" stop-color="#ffffff"/>
          <stop offset="100%" stop-color="#000000"/>
        </radialGradient>
      </defs>
    </svg>`;
    const { gradients } = parseSvg(svg);
    expect(gradients).toHaveLength(1);
    expect(gradients[0].type).toBe("radialGradient");
    expect(gradients[0].stops).toHaveLength(2);
  });

  it("extracts stop-color from inline style on stops", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g">
          <stop offset="0%" style="stop-color:#aabbcc;stop-opacity:1"/>
          <stop offset="100%" style="stop-color:#ddeeff"/>
        </linearGradient>
      </defs>
    </svg>`;
    const { colors, gradients } = parseSvg(svg);
    expect(colors.some((c) => c.hex === "#aabbcc")).toBe(true);
    expect(colors.some((c) => c.hex === "#ddeeff")).toBe(true);
    expect(gradients[0].stops).toHaveLength(2);
  });

  it("handles multiple gradients in same SVG", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="a">
          <stop offset="0%" stop-color="#111111"/>
          <stop offset="100%" stop-color="#222222"/>
        </linearGradient>
        <radialGradient id="b">
          <stop offset="0%" stop-color="#333333"/>
          <stop offset="100%" stop-color="#444444"/>
        </radialGradient>
      </defs>
    </svg>`;
    const { gradients } = parseSvg(svg);
    expect(gradients).toHaveLength(2);
    expect(gradients[0].id).toBe("a");
    expect(gradients[1].id).toBe("b");
  });

  it("parses percentage and decimal offsets", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g">
          <stop offset="0%" stop-color="#ff0000"/>
          <stop offset="0.5" stop-color="#00ff00"/>
          <stop offset="100%" stop-color="#0000ff"/>
        </linearGradient>
      </defs>
    </svg>`;
    const { gradients } = parseSvg(svg);
    expect(gradients[0].stops[0].offset).toBeCloseTo(0);
    expect(gradients[0].stops[1].offset).toBeCloseTo(0.5);
    expect(gradients[0].stops[2].offset).toBeCloseTo(1);
  });

  it("each gradient stop is an independent color in the pipeline", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g">
          <stop offset="0%" stop-color="#ff0000"/>
          <stop offset="100%" stop-color="#0000ff"/>
        </linearGradient>
      </defs>
      <rect fill="#ff0000" width="100" height="100"/>
    </svg>`;
    const { colors } = parseSvg(svg);
    // #ff0000 appears both as a gradient stop and a fill — should be deduplicated
    const red = colors.find((c) => c.hex === "#ff0000");
    expect(red).toBeDefined();
    expect(red!.frequency).toBeGreaterThanOrEqual(2);
    // #0000ff only in gradient
    expect(colors.some((c) => c.hex === "#0000ff")).toBe(true);
  });
});

// ─── svg-rewriter: gradient lightness ordering ───────────────────────────────

describe("recolorSvg — gradient lightness ordering preservation", () => {
  it("preserves light-to-dark gradient direction after remapping", () => {
    // Original: light (#ffffff) → dark (#000000)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g">
          <stop offset="0%" stop-color="#ffffff"/>
          <stop offset="100%" stop-color="#000000"/>
        </linearGradient>
      </defs>
      <rect fill="url(#g)" width="100" height="100"/>
    </svg>`;

    // Map white→dark and black→light (would invert the gradient)
    const map: ColorMap = new Map([
      ["#ffffff", "#1a1a2e"],
      ["#000000", "#f0f0f0"],
    ]);

    const result = recolorSvg(svg, map);
    const { gradients } = parseSvg(result);

    expect(gradients).toHaveLength(1);
    const stops = gradients[0].stops;
    expect(stops).toHaveLength(2);

    // After correction, first stop should be lighter than last stop
    // (preserving the original light→dark direction)
    // The correction reverses the colors to maintain ordering
    const firstL = hexToOklch(stops[0].hex).l;
    const lastL = hexToOklch(stops[1].hex).l;
    expect(firstL).toBeGreaterThan(lastL);
  });

  it("preserves dark-to-light gradient direction after remapping", () => {
    // Original: dark (#333333) → light (#eeeeee)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g">
          <stop offset="0%" stop-color="#333333"/>
          <stop offset="100%" stop-color="#eeeeee"/>
        </linearGradient>
      </defs>
      <rect fill="url(#g)" width="100" height="100"/>
    </svg>`;

    // Map dark→light and light→dark (would invert)
    const map: ColorMap = new Map([
      ["#333333", "#f5f5f5"],
      ["#eeeeee", "#111111"],
    ]);

    const result = recolorSvg(svg, map);
    const { gradients } = parseSvg(result);
    const stops = gradients[0].stops;

    const firstL2 = hexToOklch(stops[0].hex).l;
    const lastL2 = hexToOklch(stops[1].hex).l;
    // Original was dark→light, so first should be darker
    expect(firstL2).toBeLessThan(lastL2);
  });

  it("does not alter gradients when ordering is already correct", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g">
          <stop offset="0%" stop-color="#ff0000"/>
          <stop offset="100%" stop-color="#880000"/>
        </linearGradient>
      </defs>
    </svg>`;

    // Map to colors that preserve the light→dark direction
    const map: ColorMap = new Map([
      ["#ff0000", "#4488ff"],
      ["#880000", "#002266"],
    ]);

    const result = recolorSvg(svg, map);
    // Should contain the mapped colors in original order
    expect(result).toContain("#4488ff");
    expect(result).toContain("#002266");
  });

  it("handles radialGradient lightness correction", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="rg">
          <stop offset="0%" stop-color="#ffffff"/>
          <stop offset="100%" stop-color="#000000"/>
        </radialGradient>
      </defs>
    </svg>`;

    const map: ColorMap = new Map([
      ["#ffffff", "#111111"],
      ["#000000", "#eeeeee"],
    ]);

    const result = recolorSvg(svg, map);
    const { gradients } = parseSvg(result);
    const stops = gradients[0].stops;

    const firstL3 = hexToOklch(stops[0].hex).l;
    const lastL3 = hexToOklch(stops[1].hex).l;
    // Original was light→dark, correction should preserve that
    expect(firstL3).toBeGreaterThan(lastL3);
  });

  it("preserves url() references through gradient recoloring", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="mygrad">
          <stop offset="0%" stop-color="#ff0000"/>
          <stop offset="100%" stop-color="#0000ff"/>
        </linearGradient>
      </defs>
      <rect fill="url(#mygrad)" width="100" height="100"/>
    </svg>`;

    const map: ColorMap = new Map([
      ["#ff0000", "#00ff00"],
      ["#0000ff", "#ffff00"],
    ]);

    const result = recolorSvg(svg, map);
    expect(result).toContain("url(#mygrad)");
  });
});
