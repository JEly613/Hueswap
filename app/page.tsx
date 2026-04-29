"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import UploadZone from "@/components/UploadZone";
import PaletteInput from "@/components/PaletteInput";
import ResultPreview from "@/components/ResultPreview";

type AppState = "landing" | "editor";

interface FamilyMapping {
  baseHex: string;
  memberHexes: string[];
  targetHex: string;
}

const CAROUSEL_PALETTES = [
  ["#86a789", "#b2c8ba", "#d2e3c8", "#ebf3e8"],
  ["#fcf9ea", "#badfdb", "#ffa4a4", "#ffbdbd"],
  ["#ffd5e5", "#ffffdd", "#a0ffe6", "#81f5ff"],
  ["#ebebeb", "#f5a25d", "#fa7f72", "#389393"],
  ["#999b84", "#926e6f", "#ca8a8b", "#e6c4c0"],
  ["#8d7b68", "#a4907c", "#c8b6a6", "#f1dec9"],
  ["#332941", "#3b3486", "#864af9", "#f8e559"],
  ["#fffae6", "#ff9f66", "#ff5f00", "#002379"],
  ["#ffeee7", "#fbb448", "#e3670c", "#cc3d0b"],
  ["#fff5f2", "#f5babb", "#568f87", "#064232"],
  ["#e62727", "#f3f2ec", "#dcdcdc", "#1e93ab"],
  ["#627254", "#76885b", "#dddddd", "#eeeeee"],
];

// Triple the palettes so the carousel is always wider than the screen
const CAROUSEL_TRIPLE = [...CAROUSEL_PALETTES, ...CAROUSEL_PALETTES, ...CAROUSEL_PALETTES];

const DEFAULT_PALETTE = ["#332941", "#3b3486", "#864af9", "#f8e559"];

export default function Home() {
  const [appState, setAppState] = useState<AppState>("landing");
  const [svgString, setSvgString] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [palette, setPalette] = useState<string[]>(DEFAULT_PALETTE);
  const [families, setFamilies] = useState<FamilyMapping[]>([]);
  const [recoloredSvg, setRecoloredSvg] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUpload = useCallback((svg: string, name: string) => {
    if (!svg) {
      setSvgString(null);
      setFileName("");
      return;
    }
    setSvgString(svg);
    setFileName(name);
    setError(null);
  }, []);

  const handleRecolor = useCallback(async (targetPalette?: string[]) => {
    if (!svgString) return;

    const paletteToUse = targetPalette || palette;
    const validPalette = paletteToUse.every((h) => /^#[0-9a-fA-F]{6}$/.test(h));
    if (!validPalette) {
      setError("Please enter 4 valid hex colors");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/recolor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ svg: svgString, palette: paletteToUse }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Recoloring failed");
      }

      const data = await res.json();

      setFamilies(
        data.families.map(
          (f: { baseHex: string; memberHexes: string[]; targetHex: string }) => ({
            baseHex: f.baseHex,
            memberHexes: f.memberHexes,
            targetHex: f.targetHex,
          })
        )
      );
      setPalette(paletteToUse);
      setRecoloredSvg(data.recoloredSvg);
      setAppState("editor");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setIsLoading(false);
    }
  }, [svgString, palette]);

  const handlePaletteSelect = useCallback(async (newPalette: string[]) => {
    setPalette(newPalette);
    if (svgString && appState === "editor") {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/recolor", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ svg: svgString, palette: newPalette }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Recoloring failed");
        }
        const data = await res.json();
        setFamilies(
          data.families.map(
            (f: { baseHex: string; memberHexes: string[]; targetHex: string }) => ({
              baseHex: f.baseHex,
              memberHexes: f.memberHexes,
              targetHex: f.targetHex,
            })
          )
        );
        setRecoloredSvg(data.recoloredSvg);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setIsLoading(false);
      }
    }
  }, [svgString, appState]);

  const handleDownload = useCallback(() => {
    if (!recoloredSvg) return;
    const blob = new Blob([recoloredSvg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName
      ? fileName.replace(".svg", "-recolored.svg")
      : "recolored.svg";
    a.click();
    URL.revokeObjectURL(url);
  }, [recoloredSvg, fileName]);

  const handleStartOver = useCallback(() => {
    setAppState("landing");
    setSvgString(null);
    setFileName("");
    setFamilies([]);
    setRecoloredSvg("");
    setError(null);
  }, []);

  const canRecolor =
    svgString && palette.every((h) => /^#[0-9a-fA-F]{6}$/.test(h));

  // ===== LANDING PAGE =====
  if (appState === "landing") {
    return (
      <div className="relative min-h-screen flex flex-col overflow-hidden bg-[var(--background)]">
        {/* Interactive dot grid background */}
        <DotGrid />

        {/* ── TOP SECTION: carousels + title ── */}
        <div className="relative flex flex-col items-center pt-16 pb-0">
          {/* Top carousel */}
          <div className="w-full overflow-hidden pointer-events-none mb-10">
            <div className="carousel-track-left">
              {CAROUSEL_TRIPLE.map((pal, i) => (
                <div key={`top-${i}`} className="palette-strip">
                  {pal.map((color, j) => (
                    <div key={j} style={{ backgroundColor: color }} />
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* Brand mark */}
          <h1
            className="text-8xl sm:text-[10rem] leading-none tracking-tight text-[#1a1a1a] animate-fade-in-up text-center"
            style={{ fontFamily: "var(--font-instrument-serif)", animationDelay: "0s" }}
          >
            Hueswap
          </h1>

          {/* Subtitle */}
          <p
            className="mt-4 text-xl sm:text-2xl text-[#8a8279] font-light tracking-wide animate-fade-in-up text-center"
            style={{ animationDelay: "0.2s" }}
          >
            Reimagine your designs in any palette
          </p>
        </div>

        {/* ── MIDDLE SECTION: upload zone ── */}
        <div className="relative z-10 flex flex-col items-center px-6 py-10">
          {/* Upload zone */}
          <div
            className="w-full max-w-lg animate-float-up"
            style={{ animationDelay: "0.5s" }}
          >
            <UploadZone onUpload={handleUpload} svgString={svgString} />
          </div>

          {/* Palette input + recolor button — shown after upload */}
          {svgString && (
            <div className="mt-6 w-full max-w-lg animate-float-up" style={{ animationDelay: "0.1s" }}>
              <PaletteInput palette={palette} onChange={setPalette} mode="compact" />

              {error && (
                <div className="mt-4 px-3 py-2.5 rounded-lg bg-[var(--danger-soft)] border border-[var(--danger)]/20">
                  <p className="text-xs font-medium text-[var(--danger)]">{error}</p>
                </div>
              )}

              <button
                onClick={() => handleRecolor()}
                disabled={!canRecolor || isLoading}
                className={`
                  mt-4 w-full py-3.5 rounded-2xl text-sm font-semibold shadow-sm
                  transition-all duration-300
                  ${
                    canRecolor && !isLoading
                      ? "bg-[#1a1a1a] hover:bg-[#333] text-white cursor-pointer hover:shadow-lg hover:-translate-y-0.5"
                      : "bg-[var(--border)] text-[var(--muted)] cursor-not-allowed"
                  }
                `}
              >
                {isLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="w-4 h-4 animate-spin-slow" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Processing...
                  </span>
                ) : (
                  "Recolor →"
                )}
              </button>
            </div>
          )}

          {/* Feature pills — shown when no file uploaded */}
          {!svgString && <FeaturePills />}
        </div>

        {/* ── BOTTOM SECTION: bottom carousel ── */}
        <div className="mt-auto w-full overflow-hidden pointer-events-none pb-10">
          <div className="carousel-track-right">
            {CAROUSEL_TRIPLE.map((pal, i) => (
              <div key={`bottom-${i}`} className="palette-strip">
                {pal.map((color, j) => (
                  <div key={j} style={{ backgroundColor: color }} />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ===== EDITOR PAGE =====
  return (
    <div className="min-h-screen flex flex-col animate-slide-in">
      <header className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
        <button
          onClick={handleStartOver}
          className="flex items-center gap-2 text-sm text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
          Start over
        </button>
        <h1
          className="text-2xl tracking-tight text-[#1a1a1a]"
          style={{ fontFamily: "var(--font-instrument-serif)" }}
        >
          Hueswap
        </h1>
        <button
          onClick={handleDownload}
          className="flex items-center gap-2 text-sm font-medium text-white bg-[#1a1a1a] hover:bg-[#333] px-4 py-2 rounded-xl shadow-sm hover:shadow-md transition-all hover:-translate-y-0.5"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          Download
        </button>
      </header>

      <div className="flex-1 flex flex-col lg:flex-row">
        <div className="flex-1 p-6">
          <ResultPreview
            originalSvg={svgString || ""}
            recoloredSvg={recoloredSvg}
            isLoading={isLoading}
          />
        </div>
        <aside className="w-full lg:w-80 border-t lg:border-t-0 lg:border-l border-[var(--border)] p-6 bg-white/50">
          <PaletteInput
            palette={palette}
            onChange={handlePaletteSelect}
            mode="full"
          />
          {error && (
            <div className="mt-4 px-3 py-2.5 rounded-lg bg-[var(--danger-soft)] border border-[var(--danger)]/20">
              <p className="text-xs font-medium text-[var(--danger)]">{error}</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

/* Interactive dot grid with click-to-ripple color effect */
function DotGrid() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ripples = useRef<{ x: number; y: number; time: number; colorIdx: number }[]>([]);
  const animRef = useRef<number>(0);
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;

  const RIPPLE_COLORS = [
    [233, 196, 106], // amber
    [42, 157, 143],  // teal
    [231, 111, 81],  // coral
    [114, 9, 183],   // violet
    [247, 37, 133],  // pink
    [58, 12, 163],   // indigo
    [106, 153, 78],  // green
  ];

  const GAP = 28;
  const DOT_RADIUS = 1.5;
  const BASE_ALPHA = 0.12;
  const RIPPLE_SPEED = 180; // px per second
  const RIPPLE_WIDTH = 120; // width of the color band
  const RIPPLE_DURATION = 3.5; // seconds before ripple fades completely

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = 0;
    let h = 0;

    const resize = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const handleClick = (e: MouseEvent) => {
      // Don't ripple if clicking on interactive elements
      const target = e.target as HTMLElement;
      if (target.closest("button, input, a, [role='button'], .upload-zone-border")) return;

      ripples.current.push({
        x: e.clientX,
        y: e.clientY,
        time: performance.now(),
        colorIdx: Math.floor(Math.random() * RIPPLE_COLORS.length),
      });
    };
    window.addEventListener("click", handleClick);

    let lastTime = performance.now();

    const draw = (now: number) => {
      const _dt = (now - lastTime) / 1000;
      lastTime = now;

      ctx.clearRect(0, 0, w, h);

      // Clean up old ripples
      ripples.current = ripples.current.filter(
        (r) => (now - r.time) / 1000 < RIPPLE_DURATION
      );

      // Draw dots
      const cols = Math.ceil(w / GAP) + 1;
      const rows = Math.ceil(h / GAP) + 1;
      const offsetX = ((w % GAP) / 2);
      const offsetY = ((h % GAP) / 2);

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const dx = offsetX + col * GAP;
          const dy = offsetY + row * GAP;

          // Determine dot color from ripples
          let r = 200, g = 200, b = 200;
          let maxInfluence = 0;

          for (const ripple of ripples.current) {
            const elapsed = (now - ripple.time) / 1000;
            const radius = elapsed * RIPPLE_SPEED;
            const dist = Math.sqrt((dx - ripple.x) ** 2 + (dy - ripple.y) ** 2);
            const bandDist = Math.abs(dist - radius);

            if (bandDist < RIPPLE_WIDTH) {
              // Fade based on distance from the ripple ring
              const bandFade = 1 - bandDist / RIPPLE_WIDTH;
              // Fade over time
              const timeFade = 1 - elapsed / RIPPLE_DURATION;
              const influence = bandFade * timeFade * timeFade;

              if (influence > maxInfluence) {
                maxInfluence = influence;
                const c = RIPPLE_COLORS[ripple.colorIdx];
                r = c[0];
                g = c[1];
                b = c[2];
              }
            }
          }

          const alpha = BASE_ALPHA + maxInfluence * 0.7;

          ctx.beginPath();
          ctx.arc(dx, dy, DOT_RADIUS + maxInfluence * 1.2, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
          ctx.fill();
        }
      }

      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener("resize", resize);
      window.removeEventListener("click", handleClick);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 z-0"
      style={{ pointerEvents: "none" }}
    />
  );
}

/* Feature pills shown below upload zone when no file is loaded */
function FeaturePills() {
  const features = [
    { icon: "✦", label: "Preserves visual hierarchy" },
    { icon: "◈", label: "ML-powered color mapping" },
    { icon: "⬡", label: "SVG in, SVG out" },
  ];

  return (
    <div className="mt-10 flex flex-wrap items-center justify-center gap-3 animate-fade-in" style={{ animationDelay: "1s" }}>
      {features.map((f, i) => (
        <div
          key={i}
          className="flex items-center gap-2 px-4 py-2 rounded-full border border-[var(--border)] bg-white/70 backdrop-blur-sm text-sm text-[var(--muted)] hover:border-[var(--border-strong)] hover:text-[var(--foreground)] transition-all duration-200 cursor-default select-none"
        >
          <span className="text-base leading-none">{f.icon}</span>
          <span>{f.label}</span>
        </div>
      ))}
    </div>
  );
}
