export const SCENE_SCHEMA_VERSION = "1.0.0" as const;

export const MAX_SCENE_NODES = 12;

export const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export const TARGET_CONTRACT = Object.freeze({
  runtime: Object.freeze({
    representation: "runtime",
    width: 1024,
    height: 1536,
    decodedByteLength: 6_291_456,
    maximumEncodedBytes: 4_194_304,
  }),
  export: Object.freeze({
    representation: "master",
    width: 2048,
    height: 3072,
    decodedByteLength: 25_165_824,
    maximumEncodedBytes: 26_214_400,
  }),
} as const);

export const DIAGNOSTIC_PHASE_RANK = Object.freeze({
  "scene-generated-catalog": 0,
  "scene-input": 1,
  "scene-catalog": 2,
  "scene-lookup": 3,
  "scene-compatibility": 4,
  "scene-resource": 5,
  "scene-graph": 6,
  "render-input": 7,
  "render-begin": 8,
  "render-load": 9,
  "render-draw": 10,
  "render-commit": 11,
  "render-cleanup": 12,
} as const);
