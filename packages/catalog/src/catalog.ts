import {
  CatalogSchema,
  findAsset,
  findMuse,
  type AssetReference,
  type Catalog,
  type MuseReference,
} from "@editorial-doll/domain";

export const createCatalog = (input: unknown): Catalog => CatalogSchema.parse(input);

export const lookupAsset = (
  catalog: Catalog,
  reference: AssetReference,
) => findAsset(catalog, reference);

export const lookupMuse = (
  catalog: Catalog,
  reference: MuseReference,
) => findMuse(catalog, reference);
