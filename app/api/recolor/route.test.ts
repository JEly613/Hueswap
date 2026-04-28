/**
 * Unit tests for app/api/recolor/route.ts — ML integration
 *
 * Tests:
 *  - Fallback on inference failure: uses naive mapping, adds warning
 *  - No INFERENCE_URL set: uses naive mapping, no HTTP call
 *  - Response format is same RecolorResponse shape for both ML and naive paths
 *
 * Requirements: 10.3, 10.5, 10.6
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "./route";
import type { RecolorResponse } from "./route";

// ─── Minimal SVG fixture ──────────────────────────────────────────────────────

const SIMPLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
  <rect fill="#e63946" width="50" height="50"/>
  <rect fill="#457b9d" x="50" width="50" height="50"/>
  <rect fill="#1d3557" y="50" width="50" height="50"/>
  <rect fill="#a8dadc" x="50" y="50" width="50" height="50"/>
</svg>`;

const TARGET_PALETTE = ["#264653", "#2a9d8f", "#e9c46a", "#e76f51"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(body: object): Request {
  return new Request("http://localhost/api/recolor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function parseResponse(response: Response): Promise<RecolorResponse> {
  return response.json() as Promise<RecolorResponse>;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("recolor route — no INFERENCE_URL set", () => {
  beforeEach(() => {
    delete process.env.INFERENCE_URL;
    vi.restoreAllMocks();
  });

  it("uses naive mapping and makes no HTTP call when INFERENCE_URL is not set", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const req = makeRequest({ svg: SIMPLE_SVG, palette: TARGET_PALETTE });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();

    const body = await parseResponse(res);
    expect(body.recoloredSvg).toBeTruthy();
    expect(body.originalColors).toBeInstanceOf(Array);
    expect(body.families).toBeInstanceOf(Array);
    expect(body.colorMap).toBeTypeOf("object");
    expect(body.warnings).toBeInstanceOf(Array);
  });

  it("returns valid RecolorResponse shape with naive mapping", async () => {
    const req = makeRequest({ svg: SIMPLE_SVG, palette: TARGET_PALETTE });
    const res = await POST(req);
    const body = await parseResponse(res);

    // Shape checks
    expect(typeof body.recoloredSvg).toBe("string");
    expect(body.recoloredSvg.length).toBeGreaterThan(0);
    expect(Array.isArray(body.originalColors)).toBe(true);
    expect(Array.isArray(body.families)).toBe(true);
    expect(Array.isArray(body.warnings)).toBe(true);
    expect(body.colorMap).not.toBeNull();

    // Each family has the expected fields
    for (const family of body.families) {
      expect(typeof family.baseHex).toBe("string");
      expect(Array.isArray(family.memberHexes)).toBe(true);
      expect(typeof family.targetHex).toBe("string");
      expect(Array.isArray(family.featureVector)).toBe(true);
      expect(family.featureVector).toHaveLength(6);
    }
  });
});

describe("recolor route — inference failure fallback", () => {
  beforeEach(() => {
    process.env.INFERENCE_URL = "http://inference.example.com";
  });

  afterEach(() => {
    delete process.env.INFERENCE_URL;
    vi.restoreAllMocks();
  });

  it("falls back to naive mapping and adds warning when fetch throws", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network error"));

    const req = makeRequest({ svg: SIMPLE_SVG, palette: TARGET_PALETTE });
    const res = await POST(req);

    expect(res.status).toBe(200);

    const body = await parseResponse(res);
    expect(body.recoloredSvg).toBeTruthy();
    expect(body.warnings.some((w) => /fallback|naive|inference/i.test(w))).toBe(true);
  });

  it("falls back to naive mapping and adds warning when inference returns non-200", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "Internal Server Error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      })
    );

    const req = makeRequest({ svg: SIMPLE_SVG, palette: TARGET_PALETTE });
    const res = await POST(req);

    expect(res.status).toBe(200);

    const body = await parseResponse(res);
    expect(body.recoloredSvg).toBeTruthy();
    expect(body.warnings.some((w) => /fallback|naive|inference/i.test(w))).toBe(true);
  });

  it("falls back to naive mapping and adds warning on timeout (AbortError)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      Object.assign(new Error("The operation was aborted"), { name: "AbortError" })
    );

    const req = makeRequest({ svg: SIMPLE_SVG, palette: TARGET_PALETTE });
    const res = await POST(req);

    expect(res.status).toBe(200);

    const body = await parseResponse(res);
    expect(body.recoloredSvg).toBeTruthy();
    expect(body.warnings.some((w) => /fallback|naive|inference/i.test(w))).toBe(true);
  });

  it("returns same RecolorResponse shape on fallback as on naive path", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network error"));

    // ML path (with failure → fallback)
    const mlReq = makeRequest({ svg: SIMPLE_SVG, palette: TARGET_PALETTE });
    const mlRes = await POST(mlReq);
    const mlBody = await parseResponse(mlRes);

    // Naive path (no INFERENCE_URL)
    delete process.env.INFERENCE_URL;
    const naiveReq = makeRequest({ svg: SIMPLE_SVG, palette: TARGET_PALETTE });
    const naiveRes = await POST(naiveReq);
    const naiveBody = await parseResponse(naiveRes);

    // Both should have the same top-level shape
    expect(Object.keys(mlBody).sort()).toEqual(Object.keys(naiveBody).sort());
    expect(typeof mlBody.recoloredSvg).toBe(typeof naiveBody.recoloredSvg);
    expect(Array.isArray(mlBody.originalColors)).toBe(true);
    expect(Array.isArray(mlBody.families)).toBe(true);
    expect(Array.isArray(mlBody.warnings)).toBe(true);
  });
});

describe("recolor route — ML success path", () => {
  beforeEach(() => {
    process.env.INFERENCE_URL = "http://inference.example.com";
  });

  afterEach(() => {
    delete process.env.INFERENCE_URL;
    vi.restoreAllMocks();
  });

  it("uses ML-predicted OKLCH when inference returns valid response", async () => {
    // Mock inference to return a valid OKLCH prediction (fresh response per call)
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ oklch: [0.65, 0.12, 145.0] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    );

    const req = makeRequest({ svg: SIMPLE_SVG, palette: TARGET_PALETTE });
    const res = await POST(req);

    expect(res.status).toBe(200);

    const body = await parseResponse(res);
    expect(body.recoloredSvg).toBeTruthy();
    expect(body.families.length).toBeGreaterThan(0);
    // No ML-fallback warning when inference succeeds
    // (there may be other warnings like "more families than palette colors")
    const mlFailureWarnings = body.warnings.filter((w) => /ML inference failed/i.test(w));
    expect(mlFailureWarnings).toHaveLength(0);
  });

  it("returns same RecolorResponse shape on ML success as on naive path", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ oklch: [0.65, 0.12, 145.0] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    );

    const mlReq = makeRequest({ svg: SIMPLE_SVG, palette: TARGET_PALETTE });
    const mlRes = await POST(mlReq);
    const mlBody = await parseResponse(mlRes);

    // Shape checks — same as RecolorResponse
    expect(typeof mlBody.recoloredSvg).toBe("string");
    expect(Array.isArray(mlBody.originalColors)).toBe(true);
    expect(Array.isArray(mlBody.families)).toBe(true);
    expect(Array.isArray(mlBody.warnings)).toBe(true);
    expect(mlBody.colorMap).not.toBeNull();

    for (const family of mlBody.families) {
      expect(typeof family.baseHex).toBe("string");
      expect(Array.isArray(family.memberHexes)).toBe(true);
      expect(typeof family.targetHex).toBe("string");
      expect(Array.isArray(family.featureVector)).toBe(true);
      expect(family.featureVector).toHaveLength(6);
    }
  });
});

describe("recolor route — input validation", () => {
  beforeEach(() => {
    delete process.env.INFERENCE_URL;
  });

  it("returns 400 for missing svg", async () => {
    const req = makeRequest({ palette: TARGET_PALETTE });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 for missing palette", async () => {
    const req = makeRequest({ svg: SIMPLE_SVG });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 200 with empty warnings array for valid SVG with no colors", async () => {
    const emptySvg = `<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>`;
    const req = makeRequest({ svg: emptySvg, palette: TARGET_PALETTE });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await parseResponse(res);
    expect(body.originalColors).toHaveLength(0);
  });
});
