import UploadZone from "@/components/UploadZone";
import PaletteInput from "@/components/PaletteInput";
import AssignmentReview from "@/components/AssignmentReview";
import ResultPreview from "@/components/ResultPreview";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center bg-zinc-50 px-4 py-12 font-sans dark:bg-zinc-950">
      <header className="mb-12 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          Hueswap
        </h1>
        <p className="mt-2 text-lg text-zinc-500 dark:text-zinc-400">
          Intelligent SVG recoloring that preserves visual hierarchy
        </p>
      </header>

      <main className="flex w-full max-w-4xl flex-col gap-8">
        <UploadZone />
        <PaletteInput />
        <AssignmentReview />
        <ResultPreview />
      </main>
    </div>
  );
}
