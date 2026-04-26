import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { recolorSvg } from "../svg-rewriter";
import { parseSvg, extractColors } from "../svg-parser";
import type { ColorMap } from "../svg-rewriter";

const fixturesDir = join(__dirname, "fixtures");
const readFixture = (name: string) =>
  readFileSync(join(fixturesDir, name), "utf-8");

// ─── Basic Attribute Replacement ─────────────────────────────────────────────

describe("recolorSvg — fill and stroke attributes", () => {
  it("replaces a fill color", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <rect fill="#ff0000" width="100" height="50"/>
    </svg>`;
    const map: ColorMap = new Map([["#ff0000", "#00ff00"]]);
    const result = recolorSvg(svg, map);
    expect(result).toContain("#00ff00");
    expect(result).not.toContain("#ff0000");
  });

  it("replaces a stroke color", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <circle stroke="#0000ff" fill="none" r="50" cx="50" cy="50"/>
    </svg>`;
    const map: ColorMap = new Map([["#0000ff", "#ff00ff"]]);
    const result = recolorSvg(svg, map);
    expect(result).toContain("#ff00ff");
    expect(result).not.toContain("#0000ff");
  });

  it("replaces multiple colors", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <rect fill="#ff0000" width="10" height="10"/>
      <circle fill="#0000ff" r="5" cx="5" cy="5"/>
    </svg>`;
    const map: ColorMap = new Map([
      ["#ff0000", "#111111"],
      ["#0000ff", "#222222"],
    ]);
    const result = recolorSvg(svg, map);
    expect(result).toContain("#111111");
    expect(result).toContain("#222222");
  });

  it("leaves unmapped colors unchanged", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <rect fill="#ff0000" width="10" height="10"/>
      <circle fill="#00ff00" r="5" cx="5" cy="5"/>
    </svg>`;
    const map: ColorMap = new Map([["#ff0000", "#111111"]]);
    const result = recolorSvg(svg, map);
    expect(result).toContain("#111111");
    expect(result).toContain("#00ff00"); // untouched
  });
});

// ─── Skip Values ─────────────────────────────────────────────────────────────

describe("recolorSvg — preserves skip values", () => {
  it("does not touch fill=none", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <rect fill="none" stroke="#ff0000" width="10" height="10"/>
    </svg>`;
    const map: ColorMap = new Map([["#ff0000", "#00ff00"]]);
    const result = recolorSvg(svg, map);
    expect(result).toContain("none");
    expect(result).toContain("#00ff00");
  });

  it("does not touch url() references", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <rect fill="url(#grad)" width="10" height="10"/>
    </svg>`;
    const map: ColorMap = new Map();
    const result = recolorSvg(svg, map);
    expect(result).toContain("url(#grad)");
  });

  it("does not touch transparent", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <rect fill="transparent" width="10" height="10"/>
    </svg>`;
    const map: ColorMap = new Map();
    const result = recolorSvg(svg, map);
    expect(result).toContain("transparent");
  });
});

// ─── Inline Styles ───────────────────────────────────────────────────────────

describe("recolorSvg — inline styles", () => {
  it("replaces fill in inline style", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <rect style="fill:#abcdef" width="10" height="10"/>
    </svg>`;
    const map: ColorMap = new Map([["#abcdef", "#123456"]]);
    const result = recolorSvg(svg, map);
    expect(result).toContain("#123456");
    expect(result).not.toContain("#abcdef");
  });

  it("replaces stroke in inline style", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <rect style="stroke:#aabbcc;fill:none" width="10" height="10"/>
    </svg>`;
    const map: ColorMap = new Map([["#aabbcc", "#ddeeff"]]);
    const result = recolorSvg(svg, map);
    expect(result).toContain("#ddeeff");
    expect(result).toContain("none"); // fill:none preserved
  });

  it("replaces stop-color in inline style", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <stop style="stop-color:#ff0000;stop-opacity:1" offset="0%"/>
    </svg>`;
    const map: ColorMap = new Map([["#ff0000", "#00ff00"]]);
    const result = recolorSvg(svg, map);
    expect(result).toContain("#00ff00");
    expect(result).toContain("stop-opacity"); // other props preserved
  });
});

// ─── Gradient Stops ──────────────────────────────────────────────────────────

describe("recolorSvg — gradient stops", () => {
  it("replaces stop-color attributes in defs", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g">
          <stop offset="0%" stop-color="#ff0000"/>
          <stop offset="100%" stop-color="#0000ff"/>
        </linearGradient>
      </defs>
      <rect fill="url(#g)" width="100" height="100"/>
    </svg>`;
    const map: ColorMap = new Map([
      ["#ff0000", "#aaaaaa"],
      ["#0000ff", "#bbbbbb"],
    ]);
    const result = recolorSvg(svg, map);
    expect(result).toContain("#aaaaaa");
    expect(result).toContain("#bbbbbb");
    expect(result).toContain("url(#g)"); // reference preserved
  });
});

// ─── Color Format Handling ───────────────────────────────────────────────────

describe("recolorSvg — normalizes before matching", () => {
  it("matches 3-digit hex against 6-digit map key", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <rect fill="#abc" width="10" height="10"/>
    </svg>`;
    const map: ColorMap = new Map([["#aabbcc", "#112233"]]);
    const result = recolorSvg(svg, map);
    expect(result).toContain("#112233");
  });

  it("matches named color against hex map key", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <rect fill="red" width="10" height="10"/>
    </svg>`;
    const map: ColorMap = new Map([["#ff0000", "#00ff00"]]);
    const result = recolorSvg(svg, map);
    expect(result).toContain("#00ff00");
  });

  it("matches rgb() against hex map key", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <rect fill="rgb(255, 0, 0)" width="10" height="10"/>
    </svg>`;
    const map: ColorMap = new Map([["#ff0000", "#00ff00"]]);
    const result = recolorSvg(svg, map);
    expect(result).toContain("#00ff00");
  });
});

// ─── Fixture-Based Tests ─────────────────────────────────────────────────────

describe("recolorSvg — fixture: simple-icon.svg", () => {
  const svg = readFixture("simple-icon.svg");

  it("parser extracts expected colors", () => {
    const hexes = extractColors(svg);
    expect(hexes).toContain("#264653");
    expect(hexes).toContain("#e9c46a");
    expect(hexes).toContain("#e76f51");
    expect(hexes).toContain("#2a9d8f");
  });

  it("recolors all extracted colors", () => {
    const map: ColorMap = new Map([
      ["#264653", "#111111"],
      ["#e9c46a", "#222222"],
      ["#e76f51", "#333333"],
      ["#2a9d8f", "#444444"],
    ]);
    const result = recolorSvg(svg, map);

    // All originals should be gone
    expect(result).not.toContain("#264653");
    expect(result).not.toContain("#e9c46a");
    expect(result).not.toContain("#e76f51");
    expect(result).not.toContain("#2a9d8f");

    // All replacements should be present
    expect(result).toContain("#111111");
    expect(result).toContain("#222222");
    expect(result).toContain("#333333");
    expect(result).toContain("#444444");

    // fill="none" should be preserved
    expect(result).toContain("none");
  });

  it("roundtrip: recolored SVG re-parses cleanly", () => {
    const map: ColorMap = new Map([
      ["#264653", "#111111"],
      ["#e9c46a", "#222222"],
      ["#e76f51", "#333333"],
      ["#2a9d8f", "#444444"],
    ]);
    const recolored = recolorSvg(svg, map);
    const { colors } = parseSvg(recolored);
    const hexes = colors.map((c) => c.hex);
    expect(hexes).toContain("#111111");
    expect(hexes).toContain("#222222");
    expect(hexes).toContain("#333333");
    expect(hexes).toContain("#444444");
  });
});

describe("recolorSvg — fixture: gradient-badge.svg", () => {
  const svg = readFixture("gradient-badge.svg");

  it("parser extracts gradient stop colors", () => {
    const hexes = extractColors(svg);
    expect(hexes).toContain("#6366f1");
    expect(hexes).toContain("#8b5cf6");
    expect(hexes).toContain("#4f46e5");
    expect(hexes).toContain("#ffffff");
  });

  it("recolors gradient stops and preserves url() refs", () => {
    const map: ColorMap = new Map([
      ["#6366f1", "#aa0000"],
      ["#8b5cf6", "#bb0000"],
      ["#4f46e5", "#cc0000"],
      ["#ffffff", "#dddddd"],
    ]);
    const result = recolorSvg(svg, map);
    expect(result).toContain("#aa0000");
    expect(result).toContain("#bb0000");
    expect(result).toContain("#cc0000");
    expect(result).toContain("#dddddd");
    expect(result).toContain("url(#bg)");
    expect(result).toContain("url(#shine)");
  });
});

describe("recolorSvg — fixture: inline-styles.svg", () => {
  const svg = readFixture("inline-styles.svg");

  it("parser extracts colors from inline styles", () => {
    const hexes = extractColors(svg);
    expect(hexes).toContain("#1a1a2e");
    expect(hexes).toContain("#16213e");
    expect(hexes).toContain("#0f3460");
    expect(hexes).toContain("#e94560");
    expect(hexes).toContain("#ffffff");
  });

  it("recolors inline style colors", () => {
    const map: ColorMap = new Map([
      ["#1a1a2e", "#aaa001"],
      ["#16213e", "#aaa002"],
      ["#0f3460", "#aaa003"],
      ["#e94560", "#aaa004"],
      ["#ffffff", "#aaa005"],
    ]);
    const result = recolorSvg(svg, map);

    // Originals gone
    expect(result).not.toContain("#1a1a2e");
    expect(result).not.toContain("#16213e");
    expect(result).not.toContain("#0f3460");
    expect(result).not.toContain("#e94560");

    // Replacements present
    expect(result).toContain("#aaa001");
    expect(result).toContain("#aaa002");
    expect(result).toContain("#aaa003");
    expect(result).toContain("#aaa004");
    expect(result).toContain("#aaa005");
  });

  it("roundtrip: recolored inline-styles SVG re-parses", () => {
    const map: ColorMap = new Map([
      ["#1a1a2e", "#aaa001"],
      ["#16213e", "#aaa002"],
      ["#0f3460", "#aaa003"],
      ["#e94560", "#aaa004"],
      ["#ffffff", "#aaa005"],
    ]);
    const recolored = recolorSvg(svg, map);
    const hexes = extractColors(recolored);
    expect(hexes).toContain("#aaa001");
    expect(hexes).toContain("#aaa004");
  });
});

// ─── Edge Cases ──────────────────────────────────────────────────────────────

describe("recolorSvg — edge cases", () => {
  it("handles empty color map (no changes)", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <rect fill="#ff0000" width="10" height="10"/>
    </svg>`;
    const result = recolorSvg(svg, new Map());
    expect(result).toContain("#ff0000");
  });

  it("handles SVG with no colors", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <rect width="10" height="10"/>
    </svg>`;
    const result = recolorSvg(svg, new Map());
    expect(result).toContain("rect");
  });

  it("preserves SVG structure (attributes, nesting)", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <g id="layer1" transform="translate(10,10)">
        <rect fill="#ff0000" width="80" height="80" rx="5"/>
      </g>
    </svg>`;
    const map: ColorMap = new Map([["#ff0000", "#00ff00"]]);
    const result = recolorSvg(svg, map);
    expect(result).toContain('viewBox="0 0 100 100"');
    expect(result).toContain('id="layer1"');
    expect(result).toContain('transform="translate(10,10)"');
    expect(result).toContain('rx="5"');
    expect(result).toContain("#00ff00");
  });
});
