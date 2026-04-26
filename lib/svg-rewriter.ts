// lib/svg-rewriter.ts — Apply color remapping to SVG XML tree
// Handles fill/stroke attributes, inline styles, stop-color, and <defs>

import { parseSync, stringify, type INode } from "svgson";

// ─── Types ───────────────────────────────────────────────────────────────────

/** Map from original hex (lowercase, 6-digit with #) → replacement hex */
export type ColorMap = Map<string, string>;

// ─── Color Normalization (mirrors svg-parser.ts logic) ───────────────────────

const SKIP_VALUES = new Set([
  "none",
  "transparent",
  "inherit",
  "currentcolor",
  "currentColor",
  "",
]);

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
 * Normalize a color value to lowercase 6-digit hex with #.
 * Returns null if the value should be skipped.
 */
function normalizeHex(value: string): string | null {
  const trimmed = value.trim().toLowerCase();

  if (SKIP_VALUES.has(trimmed)) return null;
  if (trimmed.startsWith("url(")) return null;

  if (NAMED_COLORS[trimmed]) return NAMED_COLORS[trimmed];

  const rgbMatch = trimmed.match(
    /^rgb\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)\s*\)$/
  );
  if (rgbMatch) {
    const r = Math.min(255, Math.max(0, parseInt(rgbMatch[1], 10)));
    const g = Math.min(255, Math.max(0, parseInt(rgbMatch[2], 10)));
    const b = Math.min(255, Math.max(0, parseInt(rgbMatch[3], 10)));
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  }

  const hex3 = trimmed.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/);
  if (hex3) {
    return `#${hex3[1]}${hex3[1]}${hex3[2]}${hex3[2]}${hex3[3]}${hex3[3]}`;
  }

  if (/^#[0-9a-f]{6}$/.test(trimmed)) return trimmed;
  if (/^#[0-9a-f]{8}$/.test(trimmed)) return trimmed.slice(0, 7);

  return null;
}

// ─── Attribute Replacement ───────────────────────────────────────────────────

/**
 * Try to replace a color attribute value using the color map.
 * Returns the replacement hex if found, or the original value if not mapped.
 */
function replaceColorValue(value: string, colorMap: ColorMap): string {
  const normalized = normalizeHex(value);
  if (normalized && colorMap.has(normalized)) {
    return colorMap.get(normalized)!;
  }
  return value;
}

/**
 * Replace color references within an inline style string.
 * Handles fill, stroke, and stop-color properties.
 */
function replaceColorsInStyle(style: string, colorMap: ColorMap): string {
  return style.replace(
    /((?:fill|stroke|stop-color)\s*:\s*)([^;]+)/gi,
    (match, prefix: string, colorValue: string) => {
      const trimmed = colorValue.trim();
      const normalized = normalizeHex(trimmed);
      if (normalized && colorMap.has(normalized)) {
        return `${prefix}${colorMap.get(normalized)!}`;
      }
      return match;
    }
  );
}

// ─── Tree Walking ────────────────────────────────────────────────────────────

/**
 * Recursively walk the SVG node tree and replace colors.
 * Mutates the node in place for efficiency.
 */
function rewriteNode(node: INode, colorMap: ColorMap): void {
  // Replace fill attribute
  if (node.attributes.fill) {
    node.attributes.fill = replaceColorValue(node.attributes.fill, colorMap);
  }

  // Replace stroke attribute
  if (node.attributes.stroke) {
    node.attributes.stroke = replaceColorValue(
      node.attributes.stroke,
      colorMap
    );
  }

  // Replace stop-color attribute (gradient stops)
  if (node.attributes["stop-color"]) {
    node.attributes["stop-color"] = replaceColorValue(
      node.attributes["stop-color"],
      colorMap
    );
  }

  // Replace colors in inline style
  if (node.attributes.style) {
    node.attributes.style = replaceColorsInStyle(
      node.attributes.style,
      colorMap
    );
  }

  // Recurse into children
  for (const child of node.children) {
    rewriteNode(child, colorMap);
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Recolor an SVG string by applying a color map.
 *
 * Walks the full SVG XML tree and replaces every color reference
 * (fill, stroke, stop-color attributes and inline styles) that
 * matches a key in the color map with its mapped value.
 *
 * Does not touch: none, transparent, inherit, currentColor, url() references.
 *
 * @param svgString - The original SVG markup
 * @param colorMap - Map from original hex → replacement hex (both lowercase 6-digit with #)
 * @returns The recolored SVG markup string
 */
export function recolorSvg(svgString: string, colorMap: ColorMap): string {
  const node = parseSync(svgString);
  rewriteNode(node, colorMap);
  return stringify(node);
}

/**
 * Recolor an already-parsed SVG node tree.
 * Useful when you already have the parsed AST from svg-parser.
 * Returns a new SVG string.
 *
 * Note: This mutates the node tree. If you need the original,
 * clone it first or re-parse from the raw string.
 */
export function recolorNode(node: INode, colorMap: ColorMap): string {
  rewriteNode(node, colorMap);
  return stringify(node);
}
