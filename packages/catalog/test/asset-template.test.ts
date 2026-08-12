import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  AssetSchema,
  SemanticVersionSchema,
} from "@editorial-doll/domain";

describe("source asset template", () => {
  it("uses a valid envelope version and M1 Asset payload", async () => {
    const templateUrl = new URL(
      "../../../assets-source/_templates/asset.template.json",
      import.meta.url,
    );
    const input: unknown = JSON.parse(await readFile(templateUrl, "utf8"));

    expect(input).toBeTypeOf("object");
    expect(input).not.toBeNull();
    if (typeof input !== "object" || input === null) {
      throw new TypeError("Asset template must be an object.");
    }

    const envelope = input as Record<string, unknown>;
    expect(SemanticVersionSchema.parse(envelope["schemaVersion"])).toBe(
      "1.0.0",
    );
    expect(AssetSchema.parse(envelope["asset"])).toMatchObject({
      id: "top-example-001",
      version: "1.0.0",
      slot: "top",
    });
    expect(envelope["technical"]).toEqual({ edgeGuardExceptions: [] });
  });
});
