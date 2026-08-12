import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import {
  AssetSourceEnvelopeSchema,
  parseAssetSourceEnvelopeJson,
} from "../src/manifest.js";
import { StrictJsonError, parseStrictJson } from "../src/strict-json.js";

const validEnvelope = {
  schemaVersion: "1.0.0",
  asset: {
    id: "top-example-001",
    version: "1.0.0",
    slot: "top",
    displayName: "Example Top",
    frame: { width: 2048, height: 3072, origin: "top-left" },
    tags: ["example"],
    parts: [
      {
        id: "top-example-001-main",
        role: "top",
        sourcePath: "top.png",
      },
    ],
    compatibility: {
      compatibleMuses: [{ id: "muse-editorial-001", version: "1.0.0" }],
      requiresActiveTags: [],
      excludesActiveTags: [],
      incompatibleAssets: [],
    },
  },
  technical: { edgeGuardExceptions: [] },
};

describe("strict JSON parsing", () => {
  it("parses valid JSON", () => {
    expect(parseStrictJson('{"asset":{"id":"top-example-001"}}')).toEqual({
      asset: { id: "top-example-001" },
    });
  });

  it("rejects duplicate keys, including escaped-equivalent keys", () => {
    for (const input of ['{"id":"first","id":"second"}', '{"id":1,"\\u0069d":2}']) {
      expect(() => parseStrictJson(input)).toThrow(StrictJsonError);
      try {
        parseStrictJson(input);
      } catch (error: unknown) {
        expect(error).toMatchObject({ code: "JSON_DUPLICATE_KEY" });
      }
    }
  });

  it("reports malformed JSON with the stable invalid code", () => {
    expect(() => parseStrictJson('{"id":')).toThrow(StrictJsonError);
    try {
      parseStrictJson('{"id":');
    } catch (error: unknown) {
      expect(error).toMatchObject({ code: "JSON_INVALID" });
    }
  });

  it("rejects excessive nesting and member counts", () => {
    const deeplyNested = `${"[".repeat(65)}0${"]".repeat(65)}`;
    const tooManyMembers = `[${Array.from({ length: 10_001 }, () => "0").join(",")}]`;

    for (const input of [deeplyNested, tooManyMembers]) {
      try {
        parseStrictJson(input);
        throw new Error("Expected JSON limits to reject the input.");
      } catch (error: unknown) {
        expect(error).toMatchObject({ code: "JSON_LIMIT_EXCEEDED" });
      }
    }
  });
});

describe("asset source envelopes", () => {
  it("parses the only supported schema version and M1 asset payload", () => {
    expect(parseAssetSourceEnvelopeJson(JSON.stringify(validEnvelope))).toEqual(
      validEnvelope,
    );
  });

  it("rejects unsupported versions and unknown envelope or technical keys", () => {
    expect(() =>
      AssetSourceEnvelopeSchema.parse({ ...validEnvelope, schemaVersion: "1.0.1" }),
    ).toThrow(ZodError);
    expect(() =>
      AssetSourceEnvelopeSchema.parse({ ...validEnvelope, extra: true }),
    ).toThrow(ZodError);
    expect(() =>
      AssetSourceEnvelopeSchema.parse({
        ...validEnvelope,
        technical: { edgeGuardExceptions: [], extra: true },
      }),
    ).toThrow(ZodError);
  });

  it("validates edge-specific coordinate bounds and segment ordering", () => {
    const parseException = (exception: Record<string, unknown>) =>
      AssetSourceEnvelopeSchema.parse({
        ...validEnvelope,
        technical: { edgeGuardExceptions: [exception] },
      });

    expect(() =>
      parseException({
        edge: "top",
        startInclusive: 8,
        endInclusive: 7,
        reason: "Allowed overlap.",
      }),
    ).toThrow(ZodError);
    expect(() =>
      parseException({
        edge: "top",
        startInclusive: 0,
        endInclusive: 2048,
        reason: "Too wide.",
      }),
    ).toThrow(ZodError);
    expect(() =>
      parseException({
        edge: "left",
        startInclusive: 0,
        endInclusive: 3072,
        reason: "Too tall.",
      }),
    ).toThrow(ZodError);
    expect(() =>
      parseException({
        edge: "right",
        startInclusive: 0,
        endInclusive: 3071,
        reason: "Intentional wide accessory.",
      }),
    ).not.toThrow();
  });

  it("requires a non-empty reason and strict exception keys", () => {
    const parseException = (exception: Record<string, unknown>) =>
      AssetSourceEnvelopeSchema.parse({
        ...validEnvelope,
        technical: { edgeGuardExceptions: [exception] },
      });

    expect(() =>
      parseException({
        edge: "bottom",
        startInclusive: 2,
        endInclusive: 3,
        reason: "   ",
      }),
    ).toThrow(ZodError);
    expect(() =>
      parseException({
        edge: "bottom",
        startInclusive: 2,
        endInclusive: 3,
        reason: "Intentional bleed.",
        extra: true,
      }),
    ).toThrow(ZodError);
  });
});
