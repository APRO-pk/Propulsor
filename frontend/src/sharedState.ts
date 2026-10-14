import { useCallback } from "react";
import { create } from "zustand";
import { useEngineStore } from "./store";

/**
 * View settings that are not part of the design (a chart's metric, a burn time
 * being explored, a CSV the user imported) but must stay in step wherever the
 * same view is rendered — the inputs in the left panel and the results in the
 * Results window are two instances of one view.
 */
const useShared = create<{ values: Record<string, unknown>; set: (k: string, v: unknown) => void }>((set) => ({
  values: {},
  set: (k, v) => set((s) => ({ values: { ...s.values, [k]: v } })),
}));

/** Drop-in for useState whose value is shared by every instance using the same key. */
export function useSharedState<T>(key: string, init: T | (() => T)): [T, (v: T | ((prev: T) => T)) => void] {
  const stored = useShared((s) => s.values[key]) as T | undefined;
  const put = useShared((s) => s.set);
  const value = stored === undefined ? (typeof init === "function" ? (init as () => T)() : init) : stored;
  const setValue = useCallback(
    (v: T | ((prev: T) => T)) => {
      const prev = (useShared.getState().values[key] as T | undefined) ?? value;
      put(key, typeof v === "function" ? (v as (p: T) => T)(prev) : v);
    },
    [key, put, value],
  );
  return [value, setValue];
}

/**
 * A decision stored in the design itself (its choice bag), so it is saved with
 * the design and is the same in every window and tab. Setting the default
 * clears the key.
 */
export function useDesignChoice(key: string, def: string): [string, (v: string) => void] {
  const value = useEngineStore((s) => s.design?.choices?.[key]) ?? def;
  const set = useCallback((v: string) => void useEngineStore.getState().apply(key, v === def ? "__reset__" : v), [key, def]);
  return [value, set];
}

/** A number stored in the design itself (its param bag); see useDesignChoice. */
export function useDesignParam(key: string, def: number): [number, (v: number) => void] {
  const value = useEngineStore((s) => s.design?.params?.[key]) ?? def;
  const set = useCallback((v: number) => void useEngineStore.getState().apply(key, v), [key]);
  return [value, set];
}
