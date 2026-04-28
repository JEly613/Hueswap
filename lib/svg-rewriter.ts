// lib/svg-rewriter.ts — Apply color remapping to SVG XML tree
// Handles fill/stroke attributes, inline styles, stop-color, and <defs>
// Includes gradient-aware pass to preserve stop lightness ordering

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

// ─── Gradient Lightness Ordering ─────────────────────────────────────────────

/** Gradient tag names */
const GRADIENT_TAGS = new Set(["linearGradient", "radialGradient"]);

/**
 * Get the resolved stop-color hex from a <stop> node.
 * Checks inline style first (takes precedence), then stop-color attribute.
 */
function getStopColor(stopNode: INode): string | null {
  if (stopNode.attributes.style) {
    const match = stopNode.attributes.style.match(
      /(?:^|;)\s*stop-color\s*:\s*([^;]+)/i
    );
    if (match) {
      return normalizeHex(match[1]);
    }
  }
  if (stopNode.attributes["stop-color"]) {
    return normalizeHex(stopNode.attributes["stop-color"]);
  }
  return null;
}

/**
 * Set the stop-color on a <stop> node.
 * Updates the attribute or inline style depending on where it was originally defined.
 */
function setStopColor(stopNode: INode, hex: string): void {
  if (
    stopNode.attributes.style &&
    /stop-color/i.test(stopNode.attributes.style)
  ) {
    stopNode.attributes.style = stopNode.attributes.style.replace(
      /(stop-color\s*:\s*)([^;]+)/i,
      `$1${hex}`
    );
  } else {
    stopNode.attributes["stop-color"] = hex;
  }
}

interface GradientSnapshot {
  node: INode;
  /** Lightness direction: positive = ascending (dark→light), negative = descending (light→dark) */
  direction: number;
}

/**
 * Walk the tree and snapshot the lightness direction of every gradient
 * BEFORE rewriting colors. Returns a list of gradient nodes with their
 * original lightness direction.
 */
function snapshotGradientDirections(node: INode): GradientSnapshot[] {
  const snapshots: GradientSnapshot[] = [];

  function walk(n: INode): void {
    if (GRADIENT_TAGS.has(n.name)) {
      const stopNodes = n.children.filter((c) => c.name === "stop");
      if (stopNodes.length >= 2) {
        const firstHex = getStopColor(stopNodes[0]);
        const lastHex = getStopColor(stopNodes[stopNodes.length - 1]);
        if (firstHex && lastHex) {
          const firstL = hexToOklchLocal(firstHex);
          const lastL = hexToOklchLocal(lastHex);
          if (firstL !== null && lastL !== null) {
            const direction = lastL - firstL;
            if (Math.abs(direction) >= 0.02) {
              snapshots.push({ node: n, direction });
            }
          }
        }
      }
      return; // don't recurse into gradient children
    }
    for (const child of n.children) {
      walk(child);
    }
  }

  walk(node);
  return snapshots;
}

/** Lightweight hex→lightness without importing full color-math at module level */
function hexToOklchLocal(hex: string): number | null {
  try {
    const { parse: parseCulori, oklch: toOklch } = require("culori");
    const parsed = parseCulori(hex);
    if (!parsed) return null;
    const result = toOklch(parsed);
    return result?.l ?? null;
  } catch {
    return null;
  }
}

/**
 * After rewriting, check each snapshotted gradient and correct any
 * lightness direction inversions by swapping stop colors.
 */
function correctGradientDirections(snapshots: GradientSnapshot[]): void {
  for (const { node, direction } of snapshots) {
    const stopNodes = node.children.filter((c) => c.name === "stop");
    if (stopNodes.length < 2) continue;

    const firstHex = getStopColor(stopNodes[0]);
    const lastHex = getStopColor(stopNodes[stopNodes.length - 1]);
    if (!firstHex || !lastHex) continue;

    const firstL = hexToOklchLocal(firstHex);
    const lastL = hexToOklchLocal(lastHex);
    if (firstL === null || lastL === null) continue;

    const newDirection = lastL - firstL;

    // Check if direction flipped (signs differ and both are significant)
    const flipped =
      (direction > 0 && newDirection < -0.02) ||
      (direction < 0 && newDirection > 0.02);

    if (flipped) {
      // Reverse the stop colors (not positions/offsets)
      const hexValues = stopNodes.map((s) => getStopColor(s)!);
      const reversed = [...hexValues].reverse();
      for (let i = 0; i < stopNodes.length; i++) {
        setStopColor(stopNodes[i], reversed[i]);
      }
    }
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
  const gradientSnapshots = snapshotGradientDirections(node);
  rewriteNode(node, colorMap);
  correctGradientDirections(gradientSnapshots);
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
  const gradientSnapshots = snapshotGradientDirections(node);
  rewriteNode(node, colorMap);
  correctGradientDirections(gradientSnapshots);
  return stringify(node);
}
