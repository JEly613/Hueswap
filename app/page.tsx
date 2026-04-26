"use client";

import { useState, useCallback } from "react";
import UploadZone from "@/components/UploadZone";
import PaletteInput from "@/components/PaletteInput";
import AssignmentReview from "@/components/AssignmentReview";
import ResultPreview from "@/components/ResultPreview";
import ThemeToggle from "@/components/ThemeToggle";

type Step = "upload" | "review" | "result";

interface FamilyMapping {
  baseHex: string;
  memberHexes: string[];
  targetHex: string;
}

const DEFAULT_PALETTE = ["#264653", "#2a9d8f", "#e9c46a", "#e76f51"];

export default function Home() {
  const [step, setStep] = useState<Step>("upload");
  const [svgString, setSvgString] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [palette, setPalette] = useState<string[]>(DEFAULT_PALETTE);
  const [families, setFamilies] = useState<FamilyMapping[]>([]);
  const [recoloredSvg, setRecoloredSvg] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUpload = useCallback((svg: string, name: string) => {
    setSvgString(svg || null);
    setFileName(name);
    setStep("upload");
    setFamilies([]);
    setRecoloredSvg("");
    setError(null);
  }, []);

  const handleRecolor = useCallback(async () => {
    if (!svgString) return;

    const validPalette = palette.every((h) => /^#[0-9a-fA-F]{6}$/.test(h));
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
        body: JSON.stringify({ svg: svgString, palette }),
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
      setStep("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setIsLoading(false);
    }
  }, [svgString, palette]);

  const handleConfirmMapping = useCallback(
    async (updatedMappings: FamilyMapping[]) => {
      if (!svgString) return;

      setIsLoading(true);
      setError(null);

      try {
        const res = await fetch("/api/recolor-custom", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ svg: svgString, mappings: updatedMappings }),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Recoloring failed");
        }

        const data = await res.json();
        setFamilies(updatedMappings);
        setRecoloredSvg(data.recoloredSvg);
        setStep("result");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
        setStep("upload");
      } finally {
        setIsLoading(false);
      }
    },
    [svgString]
  );

  const handleReset = useCallback(() => {
    // Re-trigger the original recolor
    handleRecolor();
  }, [handleRecolor]);

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

  const handleBack = useCallback(() => {
    setStep("review");
  }, []);

  const canRecolor =
    svgString && palette.every((h) => /^#[0-9a-fA-F]{6}$/.test(h));

  return (
    <div className="flex min-h-screen flex-col items-center px-4 py-10 sm:py-16">
      {/* Theme toggle — top right */}
      <div className="fixed top-4 right-4 z-50">
        <ThemeToggle />
      </div>

      {/* Header */}
      <header className="mb-10 text-center">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-[var(--foreground)]">
          Hueswap
        </h1>
        <p className="mt-2 text-sm text-[var(--muted)] max-w-md">
          Upload an SVG and a target palette. Hueswap recolors your design while
          preserving its visual hierarchy.
        </p>
      </header>

      {/* Main content */}
      <main className="w-full max-w-2xl flex flex-col gap-6">
        {/* Always show upload + palette */}
        {step === "upload" && (
          <>
            <UploadZone onUpload={handleUpload} svgString={svgString} />
            <PaletteInput palette={palette} onChange={setPalette} />

            {/* Error */}
            {error && (
              <div className="px-3 py-2.5 rounded-lg bg-[var(--danger-soft)] border border-[var(--danger)]/20">
                <p className="text-xs font-medium text-[var(--danger)]">
                  {error}
                </p>
              </div>
            )}

            {/* Recolor button */}
            <button
              onClick={handleRecolor}
              disabled={!canRecolor || isLoading}
              className={`
                w-full py-3 rounded-xl text-sm font-semibold shadow-sm
                transition-all duration-200
                ${
                  canRecolor && !isLoading
                    ? "bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white cursor-pointer hover:shadow-md"
                    : "bg-[var(--border)] text-[var(--muted)] cursor-not-allowed"
                }
              `}
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg
                    className="w-4 h-4 animate-spin"
                    viewBox="0 0 24 24"
                    fill="none"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                  Processing...
                </span>
              ) : (
                "Recolor"
              )}
            </button>
          </>
        )}

        {/* Review step */}
        {step === "review" && families.length > 0 && (
          <>
            {/* Show current SVG for context */}
            {svgString && (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <p className="text-[10px] uppercase tracking-wider text-[var(--muted)] mb-3 font-medium">
                  Your SVG
                </p>
                <div className="flex items-center justify-center min-h-[120px] rounded-lg bg-[var(--background)] p-3">
                  <div
                    className="max-w-full max-h-[160px] [&>svg]:max-w-full [&>svg]:max-h-[160px] [&>svg]:w-auto [&>svg]:h-auto"
                    dangerouslySetInnerHTML={{ __html: svgString }}
                  />
                </div>
              </div>
            )}

            <AssignmentReview
              families={families}
              targetPalette={palette}
              onConfirm={handleConfirmMapping}
              onReset={handleReset}
            />

            {isLoading && (
              <div className="flex items-center justify-center py-2">
                <svg
                  className="w-5 h-5 animate-spin text-[var(--accent)]"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
              </div>
            )}

            <button
              onClick={() => setStep("upload")}
              className="text-xs font-medium text-[var(--muted)] hover:text-[var(--foreground)] self-start"
            >
              ← Back to upload
            </button>
          </>
        )}

        {/* Result step */}
        {step === "result" && recoloredSvg && svgString && (
          <>
            <ResultPreview
              originalSvg={svgString}
              recoloredSvg={recoloredSvg}
              onDownload={handleDownload}
              onBack={handleBack}
            />
            <button
              onClick={() => {
                setStep("upload");
                setFamilies([]);
                setRecoloredSvg("");
              }}
              className="text-xs font-medium text-[var(--muted)] hover:text-[var(--foreground)] self-start"
            >
              ← Start over
            </button>
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="mt-auto pt-12 pb-6">
        <p className="text-[10px] text-[var(--muted)] tracking-wider uppercase">
          Hueswap — Structural color transfer
        </p>
      </footer>
    </div>
  );
}
