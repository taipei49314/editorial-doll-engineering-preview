import { z } from "zod";

import { AssetSchema, MuseSchema, type Asset, type Muse } from "./assets.js";
import { referenceKey, type AssetReference, type MuseReference } from "./identity.js";

export const CatalogSchema = z
  .object({
    muses: z.array(MuseSchema).min(1).readonly(),
    assets: z.array(AssetSchema).readonly(),
  })
  .strict()
  .superRefine((catalog, context) => {
    const addCompositeKeyIssues = (
      entries: readonly { readonly id: string; readonly version: string }[],
      path: "muses" | "assets",
    ): void => {
      const keys = new Set<string>();
      for (const [index, entry] of entries.entries()) {
        const key = referenceKey(entry);
        if (keys.has(key)) {
          context.addIssue({
            code: "custom",
            message: `Duplicate catalog identity: ${key}.`,
            path: [path, index],
          });
        }
        keys.add(key);
      }
    };

    addCompositeKeyIssues(catalog.muses, "muses");
    addCompositeKeyIssues(catalog.assets, "assets");
  })
  .readonly();

export type Catalog = z.infer<typeof CatalogSchema>;

export const findAsset = (
  catalog: Catalog,
  reference: AssetReference,
): Asset | undefined =>
  catalog.assets.find(
    (asset) =>
      asset.id === reference.id && asset.version === reference.version,
  );

export const findMuse = (
  catalog: Catalog,
  reference: MuseReference,
): Muse | undefined =>
  catalog.muses.find(
    (muse) => muse.id === reference.id && muse.version === reference.version,
  );

export const hasAssetId = (catalog: Catalog, id: string): boolean =>
  catalog.assets.some((asset) => asset.id === id);

export const hasMuseId = (catalog: Catalog, id: string): boolean =>
  catalog.muses.some((muse) => muse.id === id);
