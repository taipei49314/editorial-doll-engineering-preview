import { expect, test } from "@playwright/test";

interface SyntheticProbeReport {
  readonly expected: readonly number[];
  readonly observed: readonly number[];
  readonly committedPixelsDetached: boolean;
  readonly drawState: {
    readonly composite: string;
    readonly alpha: number;
    readonly smoothing: boolean;
  };
}

const expectDrawState = (report: SyntheticProbeReport): void => {
  expect(report.committedPixelsDetached).toBe(true);
  expect(report.drawState).toEqual({
    composite: "source-over",
    alpha: 1,
    smoothing: false,
  });
};

const expectOpaqueCanvasProbe = (report: SyntheticProbeReport): void => {
  expect(report.observed).toEqual(report.expected);
  expectDrawState(report);
};

const expectPremultiplicationReadbackProbe = (
  report: SyntheticProbeReport,
): void => {
  expect(report.observed[3]).toBe(report.expected[3]);
  for (const channel of [0, 1, 2]) {
    expect(Math.abs((report.observed[channel] ?? 0) - (report.expected[channel] ?? 0))).toBeLessThanOrEqual(1);
  }
  expectDrawState(report);
};

test("browser adapter matches synthetic opaque and half-alpha reference probes", async ({
  page,
}) => {
  await page.goto("/");
  const reports = await page.evaluate(async () => [
    await window.__editorialDollSyntheticRenderHarness.runOpaqueProbe(),
    await window.__editorialDollSyntheticRenderHarness.runHalfAlphaProbe(),
  ]);

  const [opaqueReport, halfAlphaReport] = reports;
  expect(opaqueReport).toBeDefined();
  expect(halfAlphaReport).toBeDefined();
  if (opaqueReport === undefined || halfAlphaReport === undefined) {
    return;
  }
  expectOpaqueCanvasProbe(opaqueReport);
  expectPremultiplicationReadbackProbe(halfAlphaReport);
});

test("browser adapter rejects a forged target before allocating staging", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(() =>
    window.__editorialDollSyntheticRenderHarness.runDimensionFailureProbe(),
  );

  expect(result).toEqual({ ok: false, surfaceCalls: 0 });
});

test("browser adapter rejects staging and intrinsic source dimension mismatches", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(() =>
    window.__editorialDollSyntheticRenderHarness.runInputDimensionProbe(),
  );

  expect(result).toEqual({
    stagingMismatch: {
      begin: { ok: false, kind: "failed" },
      surfaceCalls: 1,
    },
    sourceMismatch: {
      draw: { ok: false, kind: "failed" },
      pixelAfterRejectedDraw: [0, 0, 0, 0],
      discard: { ok: true },
      commitAfterDiscard: { ok: false, kind: "failed" },
    },
  });
});

test("browser staging context is transparent alpha-enabled sRGB", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(() =>
    window.__editorialDollSyntheticRenderHarness.runContextContractProbe(),
  );

  expect(result).toEqual({
    attributesAvailable: true,
    alpha: true,
    colorSpace: "srgb",
    initialPixel: [0, 0, 0, 0],
    discard: { ok: true },
  });
});

test("browser commit owns immutable target metadata after caller mutation", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(() =>
    window.__editorialDollSyntheticRenderHarness.runTargetOwnershipProbe(),
  );

  expect(result).toEqual({
    committedTarget: {
      target: "runtime",
      representation: "runtime",
      width: 1024,
      height: 1536,
      origin: "top-left",
    },
    committedTargetFrozen: true,
    committedTargetDetachedFromCaller: true,
    committedTargetDetachedFromStaging: true,
    stagingTargetFrozen: true,
    stagingTargetDetachedFromCaller: true,
  });
});

test("browser transaction settles once and classifies commit failures", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(() =>
    window.__editorialDollSyntheticRenderHarness.runLifecycleProbe(),
  );

  expect(result).toEqual({
    commit: { ok: true },
    afterCommit: {
      draw: { ok: false, kind: "failed" },
      commit: { ok: false, kind: "failed" },
      discard: { ok: false, kind: "failed" },
    },
    discard: { ok: true },
    afterDiscard: {
      draw: { ok: false, kind: "failed" },
      commit: { ok: false, kind: "failed" },
      discard: { ok: false, kind: "failed" },
    },
    readbackFailure: {
      commit: { ok: false, kind: "readback-unavailable" },
      discard: { ok: true },
    },
    resizedCommit: { ok: false, kind: "failed" },
    malformedReadback: { ok: false, kind: "failed" },
    forgedStaging: {
      draw: { ok: false, kind: "failed" },
      commit: { ok: false, kind: "failed" },
      discard: { ok: false, kind: "failed" },
    },
  });
});
