import { describe, it, expect } from "vitest";
import { parseSvg, extractColors } from "../svg-parser";

// ─── Basic Attribute Extraction ──────────────────────────────────────────────

describe("parseSvg — fill and stroke attributes", () => {
  it("extracts fill color from a rect", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <rect fill="#ff0000" width="100" height="50"/>
    </svg>`;
    const { colors } = parseSvg(svg);
    expect(colors).toHaveLength(1);
    expect(colors[0].hex).toBe("#ff0000");
    expect(colors[0].elements).toContain("rect");
    expect(colors[0].frequency).toBe(1);
  });

  it("extracts stroke color", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <circle stroke="#00ff00" r="50" cx="50" cy="50"/>
    </svg>`;
    const { colors } = parseSvg(svg);
    expect(colors.some((c) => c.hex === "#00ff00")).toBe(true);
  });

  it("extracts both fill and stroke from same element", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <rect fill="#ff0000" stroke="#0000ff" width="100" height="50"/>
    </svg>`;
    const { colors } = parseSvg(svg);
    const hexes = colors.map((c) => c.hex);
    expect(hexes).toContain("#ff0000");
    expect(hexes).toContain("#0000ff");
  });

  it("deduplicates same color used on multiple elements", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <rect fill="#ff0000" width="100" height="50"/>
      <circle fill="#ff0000" r="25" cx="50" cy="50"/>
    </svg>`;
    const { colors } = parseSvg(svg);
    expect(colors).toHaveLength(1);
    expect(colors[0].hex).toBe("#ff0000");
    expect(colors[0].frequency).toBe(2);
    expect(colors[0].elements).toContain("rect");
    expect(colors[0].elements).toContain("circle");
  });
});

// ─── Inline Styles ───────────────────────────────────────────────────────────

describe("parseSvg — inline styles", () => {
  it("extracts fill from inline style", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <rect style="fill:#abcdef" width="100" height="50"/>
    </svg>`;
    const { colors } = parseSvg(svg);
    expect(colors.some((c) => c.hex === "#abcdef")).toBe(true);
  });

  it("extracts stroke from inline style", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <path style="stroke: #123456; fill: none" d="M0 0 L10 10"/>
    </svg>`;
    const { colors } = parseSvg(svg);
    expect(colors.some((c) => c.hex === "#123456")).toBe(true);
    // "none" should be skipped
    expect(colors.every((c) => c.hex !== "none")).toBe(true);
  });

  it("handles style with multiple properties", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <rect style="fill:#aaa;stroke:#bbb;opacity:0.5" width="10" height="10"/>
    </svg>`;
    const { colors } = parseSvg(svg);
    const hexes = colors.map((c) => c.hex);
    expect(hexes).toContain("#aaaaaa");
    expect(hexes).toContain("#bbbbbb");
  });
});

// ─── Color Format Handling ───────────────────────────────────────────────────

describe("parseSvg — color formats", () => {
  it("normalizes 3-digit hex to 6-digit", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <rect fill="#abc" width="10" height="10"/>
    </svg>`;
    const { colors } = parseSvg(svg);
    expect(colors[0].hex).toBe("#aabbcc");
  });

  it("handles rgb() format", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <rect fill="rgb(255, 128, 0)" width="10" height="10"/>
    </svg>`;
    const { colors } = parseSvg(svg);
    expect(colors[0].hex).toBe("#ff8000");
  });

  it("handles named colors", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <rect fill="red" width="10" height="10"/>
      <circle fill="blue" r="5" cx="5" cy="5"/>
    </svg>`;
    const { colors } = parseSvg(svg);
    const hexes = colors.map((c) => c.hex);
    expect(hexes).toContain("#ff0000");
    expect(hexes).toContain("#0000ff");
  });

  it("strips alpha from 8-digit hex", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <rect fill="#ff000080" width="10" height="10"/>
    </svg>`;
    const { colors } = parseSvg(svg);
    expect(colors[0].hex).toBe("#ff0000");
  });
});

// ─── Skip Values ─────────────────────────────────────────────────────────────

describe("parseSvg — skip values", () => {
  it("skips none", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <rect fill="none" stroke="#ff0000" width="10" height="10"/>
    </svg>`;
    const { colors } = parseSvg(svg);
    expect(colors).toHaveLength(1);
    expect(colors[0].hex).toBe("#ff0000");
  });

  it("skips transparent", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <rect fill="transparent" width="10" height="10"/>
    </svg>`;
    const { colors } = parseSvg(svg);
    expect(colors).toHaveLength(0);
  });

  it("skips url() references", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <rect fill="url(#gradient1)" width="10" height="10"/>
    </svg>`;
    const { colors } = parseSvg(svg);
    expect(colors).toHaveLength(0);
  });

  it("skips inherit and currentColor", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <rect fill="inherit" width="10" height="10"/>
      <circle fill="currentColor" r="5" cx="5" cy="5"/>
    </svg>`;
    const { colors } = parseSvg(svg);
    expect(colors).toHaveLength(0);
  });
});

// ─── Defs and Gradients ──────────────────────────────────────────────────────

describe("parseSvg — defs and gradients", () => {
  it("extracts stop-color from gradient stops", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="grad1">
          <stop offset="0%" stop-color="#ff0000"/>
          <stop offset="100%" stop-color="#0000ff"/>
        </linearGradient>
      </defs>
      <rect fill="url(#grad1)" width="100" height="50"/>
    </svg>`;
    const { colors } = parseSvg(svg);
    const hexes = colors.map((c) => c.hex);
    expect(hexes).toContain("#ff0000");
    expect(hexes).toContain("#0000ff");
    // url(#grad1) should be skipped
    expect(colors).toHaveLength(2);
  });

  it("extracts stop-color from inline style on stops", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g">
          <stop offset="0%" style="stop-color:#aabbcc"/>
        </linearGradient>
      </defs>
    </svg>`;
    const { colors } = parseSvg(svg);
    expect(colors.some((c) => c.hex === "#aabbcc")).toBe(true);
  });
});

// ─── Nested Groups ───────────────────────────────────────────────────────────

describe("parseSvg — nested groups", () => {
  it("extracts colors from deeply nested elements", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <g>
        <g>
          <g>
            <rect fill="#112233" width="10" height="10"/>
          </g>
        </g>
      </g>
    </svg>`;
    const { colors } = parseSvg(svg);
    expect(colors).toHaveLength(1);
    expect(colors[0].hex).toBe("#112233");
    expect(colors[0].depth).toBeGreaterThan(2);
  });

  it("extracts colors from group fill attributes", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <g fill="#aabbcc">
        <rect width="10" height="10"/>
      </g>
    </svg>`;
    const { colors } = parseSvg(svg);
    expect(colors.some((c) => c.hex === "#aabbcc")).toBe(true);
  });
});

// ─── Structural Metadata ─────────────────────────────────────────────────────

describe("parseSvg — structural metadata", () => {
  it("computes area for rect", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <rect fill="#ff0000" width="200" height="100"/>
    </svg>`;
    const { colors } = parseSvg(svg);
    expect(colors[0].area).toBe(20000);
  });

  it("computes area for circle", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <circle fill="#ff0000" r="50" cx="50" cy="50"/>
    </svg>`;
    const { colors } = parseSvg(svg);
    expect(colors[0].area).toBeCloseTo(Math.PI * 50 * 50, 0);
  });

  it("tracks element types", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <rect fill="#ff0000" width="10" height="10"/>
      <path fill="#ff0000" d="M0 0 L10 10"/>
      <text fill="#ff0000">Hello</text>
    </svg>`;
    const { colors } = parseSvg(svg);
    expect(colors[0].elements).toContain("rect");
    expect(colors[0].elements).toContain("path");
    expect(colors[0].elements).toContain("text");
    expect(colors[0].frequency).toBe(3);
  });
});

// ─── extractColors convenience ───────────────────────────────────────────────

describe("extractColors", () => {
  it("returns just hex strings", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <rect fill="#ff0000" width="10" height="10"/>
      <circle fill="#00ff00" r="5" cx="5" cy="5"/>
    </svg>`;
    const hexes = extractColors(svg);
    expect(hexes).toEqual(["#ff0000", "#00ff00"]);
  });
});

// ─── Realistic SVG ───────────────────────────────────────────────────────────

describe("parseSvg — realistic SVG", () => {
  it("handles a multi-element icon-style SVG", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#264653"/>
          <stop offset="100%" stop-color="#2a9d8f"/>
        </linearGradient>
      </defs>
      <rect fill="url(#bg)" width="100" height="100"/>
      <circle fill="#e9c46a" cx="50" cy="40" r="20"/>
      <path fill="#e76f51" d="M30 70 Q50 90 70 70"/>
      <rect fill="none" stroke="#264653" stroke-width="2" x="5" y="5" width="90" height="90" rx="10"/>
      <text fill="#264653" x="50" y="95" text-anchor="middle" font-size="8">Hello</text>
    </svg>`;

    const { colors, node } = parseSvg(svg);

    // Should find: #264653, #2a9d8f, #e9c46a, #e76f51
    const hexes = colors.map((c) => c.hex);
    expect(hexes).toContain("#264653");
    expect(hexes).toContain("#2a9d8f");
    expect(hexes).toContain("#e9c46a");
    expect(hexes).toContain("#e76f51");

    // #264653 appears in gradient stop, stroke, and text fill
    const teal = colors.find((c) => c.hex === "#264653");
    expect(teal).toBeDefined();
    expect(teal!.frequency).toBeGreaterThanOrEqual(3);

    // Node tree should be intact
    expect(node.name).toBe("svg");
  });

  it("handles SVG with no colors", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <rect width="10" height="10"/>
    </svg>`;
    const { colors } = parseSvg(svg);
    expect(colors).toHaveLength(0);
  });
});
