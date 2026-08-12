const isPlainObject = (value: object): boolean => {
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
};

/** Recursively freezes only M3-owned plain objects and arrays. */
export const deepFreezeOwned = <Value>(
  value: Value,
  opaqueValues: readonly unknown[] = [],
): Value => {
  const opaqueObjects = new Set(
    opaqueValues.filter(
      (item): item is object =>
        (typeof item === "object" && item !== null) ||
        typeof item === "function",
    ),
  );
  const visited = new WeakSet<object>();

  const visit = (candidate: unknown): void => {
    if (
      (typeof candidate !== "object" || candidate === null) &&
      typeof candidate !== "function"
    ) {
      return;
    }
    if (opaqueObjects.has(candidate) || visited.has(candidate)) {
      return;
    }
    visited.add(candidate);

    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        visit(item);
      }
      Object.freeze(candidate);
      return;
    }

    if (!isPlainObject(candidate)) {
      return;
    }
    for (const nested of Object.values(candidate)) {
      visit(nested);
    }
    Object.freeze(candidate);
  };

  visit(value);
  return value;
};
