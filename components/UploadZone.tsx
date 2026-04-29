"use client";

import { useCallback, useState, useRef } from "react";

interface UploadZoneProps {
  onUpload: (svgString: string, fileName: string) => void;
  svgString: string | null;
}

export default function UploadZone({ onUpload, svgString }: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
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

  if (svgString) {
    // Show a compact "file loaded" state
    return (
      <div className="w-full">
        <div className="flex items-center gap-3 px-5 py-4 rounded-2xl bg-white border border-[var(--border)] shadow-sm">
          <div className="w-10 h-10 rounded-xl bg-[#f0fdf4] flex items-center justify-center">
            <svg className="w-5 h-5 text-[#16a34a]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-[var(--foreground)] truncate">SVG uploaded</p>
            <p className="text-xs text-[var(--muted)]">Ready to recolor</p>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onUpload("", "");
            }}
            className="text-xs font-medium text-[var(--muted)] hover:text-[var(--danger)] px-2 py-1 rounded-lg hover:bg-[var(--danger-soft)] transition-colors"
          >
            Remove
          </button>
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

  return (
    <div className="w-full">
      <div className="upload-zone-border animate-breathe">
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={handleClick}
          className={`
            relative cursor-pointer rounded-[20px] bg-white
            transition-all duration-300 overflow-hidden
            shadow-[0_8px_40px_-12px_rgba(0,0,0,0.08)]
            hover:shadow-[0_12px_50px_-12px_rgba(0,0,0,0.12)]
            ${isDragging ? "scale-[1.02] shadow-[0_16px_60px_-12px_rgba(0,0,0,0.15)]" : ""}
          `}
        >
          <div className="flex flex-col items-center justify-center py-14 px-8">
            {/* Upload icon */}
            <div className={`
              w-14 h-14 mb-5 rounded-2xl flex items-center justify-center
              transition-all duration-300
              ${isDragging ? "bg-[#f0fdf4] scale-110" : "bg-[#faf8f5]"}
            `}>
              <svg
                className={`w-7 h-7 transition-colors duration-300 ${isDragging ? "text-[#16a34a]" : "text-[#8a8279]"}`}
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

            <p className="text-base font-medium text-[var(--foreground)]">
              {isDragging ? "Drop it here" : "Drop your SVG here"}
            </p>
            <p className="text-sm text-[var(--muted)] mt-1.5">
              or click to browse
            </p>
          </div>
        </div>
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
