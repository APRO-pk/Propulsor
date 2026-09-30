import { create } from "zustand";
import {
  getDesign,
  getPerfMap,
  setField,
  type EngineDesignDto,
  type L0ResultDto,
  type L1ResultDto,
  type L2ResultDto,
  type PerfMapDto,
} from "./api";

interface EngineState {
  design: EngineDesignDto | null;
  l0: L0ResultDto | null;
  l1: L1ResultDto | null;
  l2: L2ResultDto | null;
  perfMap: PerfMapDto | null;
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  loadPerfMap: () => Promise<void>;
  /** Persist a single field edit through the backend and refresh from the result. */
  apply: (fieldId: string, value: number | string) => Promise<void>;
  setThrust: (n: number) => void;
  /** New design: blank every requirement and clear all custom params/choices. */
  reset: () => Promise<void>;
  /** Load a previously-saved design (from JSON) by replaying its fields. */
  importDesign: (dto: EngineDesignDto) => Promise<void>;
}

function hydrate(design: EngineDesignDto) {
  const find = <T>(tier: string): T | null =>
    (design.caches.find((c) => c.tier === tier)?.payload as T | undefined) ?? null;
  return {
    design,
    l0: find<L0ResultDto>("L0"),
    l1: find<L1ResultDto>("L1"),
    l2: find<L2ResultDto>("L2"),
  };
}

export const useEngineStore = create<EngineState>((set) => ({
  design: null,
  l0: null,
  l1: null,
  l2: null,
  perfMap: null,
  loading: false,
  error: null,

  async load() {
    set({ loading: true, error: null });
    try {
      const design = await getDesign();
      set({ ...hydrate(design), loading: false });
    } catch (err) {
      set({ loading: false, error: String(err) });
    }
  },

  async loadPerfMap() {
    try {
      const perfMap = await getPerfMap();
      set({ perfMap });
    } catch (err) {
      set({ error: String(err) });
    }
  },

  async apply(fieldId, value) {
    try {
      const design = await setField(fieldId, value);
      if (design) set({ ...hydrate(design), error: null });
    } catch (err) {
      set({ error: String(err) });
    }
  },

  setThrust(thrust: number) {
    void useEngineStore.getState().apply("thrust", thrust);
  },

  async reset() {
    const { design, apply } = useEngineStore.getState();
    // Clear every custom subsystem param/choice first (revert to defaults).
    const keys = [
      ...Object.keys(design?.params ?? {}),
      ...Object.keys(design?.choices ?? {}),
    ];
    for (const k of keys) await apply(k, "__reset__");
    // Then blank the core requirements → the design becomes unconfigured.
    await apply("propellant_pair", "");
    await apply("thrust", 0);
    await apply("chamber_pressure", 0);
    await apply("mixture_ratio", 0);
  },

  async importDesign(dto) {
    const { apply } = useEngineStore.getState();
    // Replay the saved design through the field API so it reconstructs on any
    // backend (Tauri host, HTTP host, or the browser mock).
    if (dto.propellant?.pair) await apply("propellant_pair", dto.propellant.pair);
    if (dto.operating_point) {
      await apply("thrust", dto.operating_point.thrust ?? 0);
      await apply("chamber_pressure", dto.operating_point.chamber_pressure ?? 0);
      await apply("mixture_ratio", dto.operating_point.mixture_ratio ?? 0);
      if (dto.operating_point.c_star_efficiency)
        await apply("c_star_efficiency", dto.operating_point.c_star_efficiency);
    }
    const lStar = dto.geometry?.chamber?.l_star_m;
    if (lStar) await apply("l_star", lStar);
    const kind = dto.geometry?.nozzle?.kind;
    if (kind) await apply("nozzle_kind", kind);
    const method = dto.geometry?.cooling_jacket?.cooling_method;
    if (method) await apply("cooling_method", method);
    if (dto.materials?.chamber) await apply("wall_material", dto.materials.chamber);
    if (dto.materials?.nozzle) await apply("nozzle_material", dto.materials.nozzle);
    // Recover the expansion ratio from the solved L2 cache if present.
    const l2 = dto.caches?.find((c) => c.tier === "L2")?.payload as { area_ratio?: number } | undefined;
    if (l2?.area_ratio) await apply("expansion_ratio", Number(l2.area_ratio.toFixed(2)));
    for (const [k, v] of Object.entries(dto.params ?? {})) await apply(k, v);
    for (const [k, v] of Object.entries(dto.choices ?? {})) await apply(k, v);
  },
}));
