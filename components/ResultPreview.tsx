"use client";

interface ResultPreviewProps {
  originalSvg: string;
  recoloredSvg: string;
  onDownload: () => void;
  onBack: () => void;
}

export default function ResultPreview({
  originalSvg,
  recoloredSvg,
  onDownload,
  onBack,
}: ResultPreviewProps) {
  return (
    <div className="w-full">
      <label className="block text-sm font-medium text-[var(--muted)] mb-2 uppercase tracking-wider">
        Result
      </label>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
        {/* Side-by-side comparison */}
        <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-[var(--border)]">
          {/* Original */}
          <div className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-[var(--muted)] mb-3 font-medium">
              Original
            </p>
            <div className="flex items-center justify-center min-h-[180px] rounded-lg bg-[var(--background)] p-4">
              <div
                className="max-w-full max-h-[200px] [&>svg]:max-w-full [&>svg]:max-h-[200px] [&>svg]:w-auto [&>svg]:h-auto"
                dangerouslySetInnerHTML={{ __html: originalSvg }}
              />
            </div>
          </div>

          {/* Recolored */}
          <div className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-[var(--muted)] mb-3 font-medium">
              Recolored
            </p>
            <div className="flex items-center justify-center min-h-[180px] rounded-lg bg-[var(--background)] p-4">
              <div
                className="max-w-full max-h-[200px] [&>svg]:max-w-full [&>svg]:max-h-[200px] [&>svg]:w-auto [&>svg]:h-auto"
                dangerouslySetInnerHTML={{ __html: recoloredSvg }}
              />
            </div>
          </div>
        </div>

        {/* Actions bar */}
        <div className="flex items-center justify-between px-4 py-3 bg-[var(--surface-hover)] border-t border-[var(--border)]">
          <button
            onClick={onBack}
            className="text-xs font-medium text-[var(--muted)] hover:text-[var(--foreground)] px-3 py-1.5 rounded-md hover:bg-[var(--surface)]"
          >
            ← Adjust mapping
          </button>
          <button
            onClick={onDownload}
            className="flex items-center gap-2 text-sm font-medium text-white bg-[var(--accent)] hover:bg-[var(--accent-hover)] px-4 py-2 rounded-lg shadow-sm"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
              />
            </svg>
            Download SVG
          </button>
        </div>
      </div>
    </div>
  );
}
