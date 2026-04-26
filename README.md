# Hueswap

Intelligent SVG recoloring that preserves visual hierarchy.

Upload an SVG and a target color palette — Hueswap maps colors structurally, not by find-and-replace.

## Tech Stack

- **Frontend:** Next.js 14+, TypeScript, Tailwind CSS
- **Color Math:** culori (OKLCH), svgson (SVG parsing)
- **ML:** PyTorch (two-stage encoder + mapper)
- **Inference:** FastAPI on Railway
- **Hosting:** Vercel

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Project Structure

```
app/          → Next.js app router (pages + API routes)
lib/          → Core logic (color math, SVG parsing, clustering, rewriting)
components/   → React UI components
ml/           → ML training scripts (Python, offline)
inference/    → FastAPI inference service
```
