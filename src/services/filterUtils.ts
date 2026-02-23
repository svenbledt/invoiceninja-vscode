import { FILTER_VALUE_ALL, FILTER_VALUE_NONE } from "../types/contracts";

export function normalizeFilterSelection(value: string | undefined | null): string {
  const text = String(value ?? "").trim();
  return text || FILTER_VALUE_ALL;
}

export function toApiFilterValue(value: string | undefined | null): string | undefined {
  const selected = normalizeFilterSelection(value);
  if (selected === FILTER_VALUE_ALL || selected === FILTER_VALUE_NONE) {
    return undefined;
  }
  return selected;
}

export function matchesFilterSelection(selected: string | undefined | null, candidate: string | undefined | null): boolean {
  const filter = normalizeFilterSelection(selected);
  const value = String(candidate ?? "").trim();

  if (filter === FILTER_VALUE_ALL) {
    return true;
  }
  if (filter === FILTER_VALUE_NONE) {
    return value === "";
  }
  return value === filter;
}
