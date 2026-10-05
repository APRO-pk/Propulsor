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
  /** Undo/redo history of whole-design snapshots (report option #16). */
  undoStack: EngineDesignDto[];
  redoStack: EngineDesignDto[];
  load: () => Promise<void>;
  loadPerfMap: () => Promise<void>;
  /** Persist a single field edit through the backend and refresh from the result. */
  apply: (fieldId: string, value: number | string) => Promise<void>;
  setThrust: (n: number) => void;
  /** New design: blank every requirement and clear all custom params/choices. */
  reset: () => Promise<void>;
  /** Load a previously-saved design (from JSON) by replaying its fields. */
  importDesign: (dto: EngineDesignDto) => Promise<void>;
  /** Step back / forward through the edit history. */
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

/** Cap on retained history snapshots (memory bound). */
const HISTORY_LIMIT = 50;
/** When false, backend replays (reset/import/undo/redo) don't record history. */
let recording = true;
/** Deep-clone a snapshot so history is independent of later in-place mutation
 * (the browser mock returns one shared design object). */
const snap = (d: EngineDesignDto): EngineDesignDto => JSON.parse(JSON.stringify(d));

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
  undoStack: [],
  redoStack: [],

  async load() {
    set({ loading: true, error: null });
    try {
      const design = await getDesign();
      set({ ...hydrate(design), loading: false, undoStack: [], redoStack: [] });
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
    // Clone the pre-edit snapshot *before* setField runs: the browser mock mutates
    // and returns one shared design object, so a post-edit clone would already hold
    // the new value.
    const cur = useEngineStore.getState().design;
    const prev = recording && cur ? snap(cur) : null;
    try {
      const design = await setField(fieldId, value);
      if (design) {
        if (prev) {
          const undoStack = [...useEngineStore.getState().undoStack, prev].slice(-HISTORY_LIMIT);
          set({ undoStack, redoStack: [] });
        }
        set({ ...hydrate(design), error: null });
      }
    } catch (err) {
      set({ error: String(err) });
    }
  },

  setThrust(thrust: number) {
    void useEngineStore.getState().apply("thrust", thrust);
  },

  async reset() {
    // Atomic w.r.t. history: one undo step returns to the pre-reset design.
    const cur = useEngineStore.getState().design;
    const prev = cur ? snap(cur) : null; // clone before clearAll mutates it
    recording = false;
    await clearAll();
    recording = true;
    if (prev) set({ undoStack: [...useEngineStore.getState().undoStack, prev].slice(-HISTORY_LIMIT), redoStack: [] });
  },

  async importDesign(dto) {
    const cur = useEngineStore.getState().design;
    const prev = cur ? snap(cur) : null; // clone before replay mutates it
    recording = false;
    await replay(dto);
    recording = true;
    if (prev) set({ undoStack: [...useEngineStore.getState().undoStack, prev].slice(-HISTORY_LIMIT), redoStack: [] });
  },

  async undo() {
    const { undoStack, design } = useEngineStore.getState();
    if (undoStack.length === 0 || !design) return;
    const target = undoStack[undoStack.length - 1];
    set({ undoStack: undoStack.slice(0, -1), redoStack: [...useEngineStore.getState().redoStack, snap(design)].slice(-HISTORY_LIMIT) });
    await restoreSnapshot(target);
  },

  async redo() {
    const { redoStack, design } = useEngineStore.getState();
    if (redoStack.length === 0 || !design) return;
    const target = redoStack[redoStack.length - 1];
    set({ redoStack: redoStack.slice(0, -1), undoStack: [...useEngineStore.getState().undoStack, snap(design)].slice(-HISTORY_LIMIT) });
    await restoreSnapshot(target);
  },
}));

/** Blank the core requirements and clear every custom param/choice. */
async function clearAll() {
  const { design, apply } = useEngineStore.getState();
  const keys = [...Object.keys(design?.params ?? {}), ...Object.keys(design?.choices ?? {})];
  for (const k of keys) await apply(k, "__reset__");
  await apply("propellant_pair", "");
  await apply("thrust", 0);
  await apply("chamber_pressure", 0);
  await apply("mixture_ratio", 0);
}

/** Replay a saved design DTO through the field API (backend-agnostic). */
async function replay(dto: EngineDesignDto) {
  const { apply } = useEngineStore.getState();
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
  const l2 = dto.caches?.find((c) => c.tier === "L2")?.payload as { area_ratio?: number } | undefined;
  if (l2?.area_ratio) await apply("expansion_ratio", Number(l2.area_ratio.toFixed(2)));
  for (const [k, v] of Object.entries(dto.params ?? {})) await apply(k, v);
  for (const [k, v] of Object.entries(dto.choices ?? {})) await apply(k, v);
}

/** Reconstruct a snapshot on the backend without recording new history. */
async function restoreSnapshot(snap: EngineDesignDto) {
  recording = false;
  await clearAll();
  await replay(snap);
  recording = true;
}
