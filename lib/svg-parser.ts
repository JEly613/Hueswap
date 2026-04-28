// lib/svg-parser.ts — SVG parsing + color extraction using svgson
// Extracts unique colors with structural metadata from SVG XML

import { parseSync, type INode } from "svgson";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ExtractedColor {
  /** Normalized hex string (lowercase, 6-digit, with #) */
  hex: string;
  /** Element tag names using this color (e.g. ['rect', 'path']) */
  elements: string[];
  /** How many elements reference this color */
  frequency: number;
  /** Approximate total area of elements using this color */
  area: number;
  /** Average DOM depth of elements using this color */
  depth: number;
}

export interface ColorUsage {
  hex: string;
  element: string;
  attribute: "fill" | "stroke" | "style-fill" | "style-stroke" | "stop-color";
  area: number;
  depth: number;
  /** If this color is a gradient stop, the gradient ID and stop index */
  gradientInfo?: {
    gradientId: string;
    gradientType: "linearGradient" | "radialGradient";
    stopIndex: number;
    offset: string;
  };
}

/** Extracted gradient with its ordered stop colors */
export interface ExtractedGradient {
  id: string;
  type: "linearGradient" | "radialGradient";
  stops: {
    offset: number;
    hex: string;
  }[];
}

export interface ParsedSvg {
  /** The parsed SVG AST node tree */
  node: INode;
  /** All unique colors extracted with structural metadata */
  colors: ExtractedColor[];
  /** Gradients found in the SVG with their ordered stops */
  gradients: ExtractedGradient[];
  /** Raw SVG string for re-serialization */
  raw: string;
}

// ─── Color Normalization ─────────────────────────────────────────────────────

/** Colors to skip — not real colors */
const SKIP_VALUES = new Set([
  "none",
  "transparent",
  "inherit",
  "currentcolor",
  "currentColor",
  "",
]);

/** Named CSS colors → hex (common subset). Extend as needed. */
const NAMED_COLORS: Record<string, string> = {
  black: "#000000",
  white: "#ffffff",
  red: "#ff0000",
  green: "#008000",
  blue: "#0000ff",
  yellow: "#ffff00",
  cyan: "#00ffff",
  magenta: "#ff00ff",
  orange: "#ffa500",
  purple: "#800080",
  pink: "#ffc0cb",
  gray: "#808080",
  grey: "#808080",
  silver: "#c0c0c0",
  maroon: "#800000",
  olive: "#808000",
  lime: "#00ff00",
  teal: "#008080",
  navy: "#000080",
  aqua: "#00ffff",
  fuchsia: "#ff00ff",
};

/**
 * Normalize a color value to a lowercase 6-digit hex string with #.
 * Returns null if the value should be skipped.
 */
function normalizeHex(value: string): string | null {
  const trimmed = value.trim().toLowerCase();

  if (SKIP_VALUES.has(trimmed)) return null;
  if (trimmed.startsWith("url(")) return null;

  // Named color
  if (NAMED_COLORS[trimmed]) return NAMED_COLORS[trimmed];

  // rgb(r, g, b) or rgb(r g b)
  const rgbMatch = trimmed.match(
    /^rgb\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)\s*\)$/
  );
  if (rgbMatch) {
    const r = Math.min(255, Math.max(0, parseInt(rgbMatch[1], 10)));
    const g = Math.min(255, Math.max(0, parseInt(rgbMatch[2], 10)));
    const b = Math.min(255, Math.max(0, parseInt(rgbMatch[3], 10)));
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  }

  // 3-digit hex → 6-digit
  const hex3 = trimmed.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/);
  if (hex3) {
    return `#${hex3[1]}${hex3[1]}${hex3[2]}${hex3[2]}${hex3[3]}${hex3[3]}`;
  }

  // 6-digit hex
  if (/^#[0-9a-f]{6}$/.test(trimmed)) return trimmed;

  // 8-digit hex (with alpha) → strip alpha
  if (/^#[0-9a-f]{8}$/.test(trimmed)) return trimmed.slice(0, 7);

  return null;
}

// ─── Style Parsing ───────────────────────────────────────────────────────────

/**
 * Extract fill and stroke colors from an inline style attribute.
 * Handles: style="fill:#abc; stroke: rgb(1,2,3)"
 */
function extractColorsFromStyle(style: string): {
  fill: string | null;
  stroke: string | null;
  stopColor: string | null;
} {
  let fill: string | null = null;
  let stroke: string | null = null;
  let stopColor: string | null = null;

  // Match fill: value
  const fillMatch = style.match(/(?:^|;)\s*fill\s*:\s*([^;]+)/i);
  if (fillMatch) fill = normalizeHex(fillMatch[1]);

  // Match stroke: value
  const strokeMatch = style.match(/(?:^|;)\s*stroke\s*:\s*([^;]+)/i);
  if (strokeMatch) stroke = normalizeHex(strokeMatch[1]);

  // Match stop-color: value (for gradients)
  const stopMatch = style.match(/(?:^|;)\s*stop-color\s*:\s*([^;]+)/i);
  if (stopMatch) stopColor = normalizeHex(stopMatch[1]);

  return { fill, stroke, stopColor };
}

// ─── Area Estimation ─────────────────────────────────────────────────────────

/**
 * Estimate the area of an SVG element from its attributes.
 * This is approximate — good enough for weighting color importance.
 */
function estimateArea(node: INode): number {
  const attrs = node.attributes;
  const name = node.name;

  switch (name) {
    case "rect": {
      const w = parseFloat(attrs.width || "0");
      const h = parseFloat(attrs.height || "0");
      return w * h;
    }
    case "circle": {
      const r = parseFloat(attrs.r || "0");
      return Math.PI * r * r;
    }
    case "ellipse": {
      const rx = parseFloat(attrs.rx || "0");
      const ry = parseFloat(attrs.ry || "0");
      return Math.PI * rx * ry;
    }
    case "line":
      return 0; // Lines have no fill area
    case "polygon":
    case "polyline":
      // Rough estimate: bounding box of points
      return estimatePolygonArea(attrs.points || "");
    case "path":
      // Paths are complex — use a default moderate area
      return 100;
    case "text":
      return 50; // Text area is hard to estimate
    default:
      return 10; // Default for unknown elements
  }
}

/**
 * Rough polygon area estimate from points attribute.
 * Uses the shoelace formula on the parsed coordinates.
 */
function estimatePolygonArea(points: string): number {
  const coords = points
    .trim()
    .split(/[\s,]+/)
    .map(Number)
    .filter((n) => !isNaN(n));

  if (coords.length < 6) return 0; // Need at least 3 points

  let area = 0;
  const n = Math.floor(coords.length / 2);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += coords[i * 2] * coords[j * 2 + 1];
    area -= coords[j * 2] * coords[i * 2 + 1];
  }
  return Math.abs(area) / 2;
}

// ─── Tree Walking ────────────────────────────────────────────────────────────

/** Gradient tag names we explicitly handle */
const GRADIENT_TAGS = new Set(["linearGradient", "radialGradient"]);

/**
 * Parse a stop offset value to a number in [0, 1].
 * Handles "50%", "0.5", or missing values.
 */
function parseOffset(offset: string | undefined): number {
  if (!offset) return 0;
  const trimmed = offset.trim();
  if (trimmed.endsWith("%")) {
    return parseFloat(trimmed) / 100;
  }
  return parseFloat(trimmed) || 0;
}

/**
 * Extract gradient stop colors from a <linearGradient> or <radialGradient> node.
 * Returns the gradient info and also pushes color usages for each stop.
 */
function extractGradientStops(
  node: INode,
  depth: number,
  usages: ColorUsage[],
  gradients: ExtractedGradient[]
): void {
  const gradientId = node.attributes.id || "";
  const gradientType = node.name as "linearGradient" | "radialGradient";
  const stops: ExtractedGradient["stops"] = [];

  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    if (child.name !== "stop") continue;

    let hex: string | null = null;

    // Check stop-color attribute
    if (child.attributes["stop-color"]) {
      hex = normalizeHex(child.attributes["stop-color"]);
    }

    // Check inline style for stop-color (overrides attribute)
    if (child.attributes.style) {
      const { stopColor } = extractColorsFromStyle(child.attributes.style);
      if (stopColor) hex = stopColor;
    }

    if (hex) {
      const offset = parseOffset(child.attributes.offset);

      usages.push({
        hex,
        element: "stop",
        attribute: "stop-color",
        area: 10, // Gradient stops get a default area
        depth: depth + 1,
        gradientInfo: {
          gradientId,
          gradientType,
          stopIndex: i,
          offset: child.attributes.offset || "0%",
        },
      });

      stops.push({ offset, hex });
    }
  }

  if (stops.length > 0) {
    gradients.push({ id: gradientId, type: gradientType, stops });
  }
}

/**
 * Recursively walk the SVG node tree and collect color usages.
 */
function walkNode(
  node: INode,
  depth: number,
  usages: ColorUsage[],
  gradients: ExtractedGradient[]
): void {
  // Explicitly handle gradient elements
  if (GRADIENT_TAGS.has(node.name)) {
    extractGradientStops(node, depth, usages, gradients);
    return; // Don't recurse further — stops are handled above
  }

  const area = estimateArea(node);

  // Check fill attribute
  if (node.attributes.fill) {
    const hex = normalizeHex(node.attributes.fill);
    if (hex) {
      usages.push({
        hex,
        element: node.name,
        attribute: "fill",
        area,
        depth,
      });
    }
  }

  // Check stroke attribute
  if (node.attributes.stroke) {
    const hex = normalizeHex(node.attributes.stroke);
    if (hex) {
      usages.push({
        hex,
        element: node.name,
        attribute: "stroke",
        area,
        depth,
      });
    }
  }

  // Check stop-color attribute (for stops outside gradient context, e.g. nested)
  if (node.attributes["stop-color"]) {
    const hex = normalizeHex(node.attributes["stop-color"]);
    if (hex) {
      usages.push({
        hex,
        element: node.name,
        attribute: "stop-color",
        area,
        depth,
      });
    }
  }

  // Check inline style
  if (node.attributes.style) {
    const { fill, stroke, stopColor } = extractColorsFromStyle(
      node.attributes.style
    );
    if (fill) {
      usages.push({
        hex: fill,
        element: node.name,
        attribute: "style-fill",
        area,
        depth,
      });
    }
    if (stroke) {
      usages.push({
        hex: stroke,
        element: node.name,
        attribute: "style-stroke",
        area,
        depth,
      });
    }
    if (stopColor) {
      usages.push({
        hex: stopColor,
        element: node.name,
        attribute: "stop-color",
        area,
        depth,
      });
    }
  }

  // Recurse into children (handles <defs>, <g>, etc.)
  for (const child of node.children) {
    walkNode(child, depth + 1, usages, gradients);
  }
}

// ─── Aggregation ─────────────────────────────────────────────────────────────

/**
 * Aggregate raw color usages into unique ExtractedColor entries.
 */
function aggregateUsages(usages: ColorUsage[]): ExtractedColor[] {
  const map = new Map<
    string,
    {
      elements: Set<string>;
      frequency: number;
      totalArea: number;
      totalDepth: number;
    }
  >();

  for (const usage of usages) {
    const existing = map.get(usage.hex);
    if (existing) {
      existing.elements.add(usage.element);
      existing.frequency++;
      existing.totalArea += usage.area;
      existing.totalDepth += usage.depth;
    } else {
      map.set(usage.hex, {
        elements: new Set([usage.element]),
        frequency: 1,
        totalArea: usage.area,
        totalDepth: usage.depth,
      });
    }
  }

  return Array.from(map.entries()).map(([hex, data]) => ({
    hex,
    elements: Array.from(data.elements),
    frequency: data.frequency,
    area: data.totalArea,
    depth: data.totalDepth / data.frequency, // average depth
  }));
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Parse an SVG string and extract all unique colors with structural metadata.
 *
 * Handles:
 * - fill and stroke attributes
 * - inline styles (style="fill:#xxx; stroke:#yyy")
 * - Colors in <defs> (gradients, patterns)
 * - stop-color on gradient stops
 * - Named colors, rgb(), 3/6/8-digit hex
 *
 * Skips: none, transparent, inherit, currentColor, url() references
 */
export function parseSvg(svgString: string): ParsedSvg {
  const node = parseSync(svgString);
  const usages: ColorUsage[] = [];
  const gradients: ExtractedGradient[] = [];

  walkNode(node, 0, usages, gradients);

  const colors = aggregateUsages(usages);

  return {
    node,
    colors,
    gradients,
    raw: svgString,
  };
}

/**
 * Get just the unique hex colors from an SVG string.
 * Convenience function for simple use cases.
 */
export function extractColors(svgString: string): string[] {
  const { colors } = parseSvg(svgString);
  return colors.map((c) => c.hex);
}
