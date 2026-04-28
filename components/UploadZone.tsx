"use client";

import { useCallback, useState, useRef, useMemo } from "react";

interface UploadZoneProps {
  onUpload: (svgString: string, fileName: string) => void;
  svgString: string | null;
}

export default function UploadZone({ onUpload, svgString }: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    (file: File) => {
      if (!file.name.endsWith(".svg") && file.type !== "image/svg+xml") {
        alert("Please upload an SVG file");
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        setFileName(file.name);
        onUpload(text, file.name);
      };
      reader.readAsText(file);
    },
    [onUpload]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleClick = () => inputRef.current?.click();

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    setFileName(null);
    onUpload("", "");
    if (inputRef.current) inputRef.current.value = "";
  };

  const aspectRatio = useMemo(() => {
    if (!svgString) return undefined;
    const vbMatch = svgString.match(/viewBox=["']([^"']+)["']/);
    if (vbMatch) {
      const parts = vbMatch[1].trim().split(/[\s,]+/);
      if (parts.length === 4) {
        const w = parseFloat(parts[2]);
        const h = parseFloat(parts[3]);
        if (w > 0 && h > 0) return w / h;
      }
    }
    const wMatch = svgString.match(/\bwidth=["'](\d+(?:\.\d+)?)(?:px)?["']/);
    const hMatch = svgString.match(/\bheight=["'](\d+(?:\.\d+)?)(?:px)?["']/);
    if (wMatch && hMatch) {
      const w = parseFloat(wMatch[1]);
      const h = parseFloat(hMatch[1]);
      if (w > 0 && h > 0) return w / h;
    }
    return undefined;
  }, [svgString]);

  return (
    <div className="w-full">
      <label className="block text-sm font-medium text-[var(--muted)] mb-2 uppercase tracking-wider">
        Upload SVG
      </label>
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={handleClick}
        className={`
          relative cursor-pointer rounded-xl border-2 border-dashed
          transition-all duration-200 overflow-hidden
          ${
            isDragging
              ? "border-[var(--accent)] bg-[var(--accent-soft)] scale-[1.01]"
              : svgString
                ? "border-[var(--border-strong)] bg-[var(--surface)]"
                : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]"
          }
        `}
      >
        {svgString ? (
          <div className="relative">
            {/* SVG Preview */}
            <div className="flex items-center justify-center p-6">
              <div
                className="w-full max-w-md"
                style={aspectRatio ? { aspectRatio: `${aspectRatio}` } : undefined}
              >
                <div
                  className="w-full h-full [&>svg]:w-full [&>svg]:h-full [&>svg]:block"
                  dangerouslySetInnerHTML={{ __html: svgString }}
                />
              </div>
            </div>
            {/* File info bar */}
            <div className="flex items-center justify-between px-4 py-2.5 bg-[var(--surface-hover)] border-t border-[var(--border)]">
              <span className="text-sm font-mono text-[var(--muted)] truncate">
                {fileName}
              </span>
              <button
                onClick={handleClear}
                className="text-xs font-medium text-[var(--danger)] hover:text-[var(--danger)] px-2 py-1 rounded hover:bg-[var(--danger-soft)]"
              >
                Remove
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 px-6">
            <div className="w-12 h-12 mb-4 rounded-lg bg-[var(--accent-soft)] flex items-center justify-center">
              <svg
                className="w-6 h-6 text-[var(--accent)]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
                />
              </svg>
            </div>
            <p className="text-sm font-medium text-[var(--foreground)]">
              Drop your SVG here
            </p>
            <p className="text-xs text-[var(--muted)] mt-1">
              or click to browse
            </p>
          </div>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".svg,image/svg+xml"
        onChange={handleInputChange}
        className="hidden"
      />
    </div>
  );
}
