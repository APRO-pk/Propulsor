import { useEffect, useState } from "react";
import { useEngineStore } from "./store";
import { DIMS, unitOf, type Dim } from "./units";

/** The persisted per-field unit choice key for a param/field key. */
export const unitKeyFor = (k: string) => `unit.${k}`;

/** A compact unit dropdown bound to `design.choices["unit.<k>"]`. */
function UnitSelect({ dim, k, def }: { dim: Dim; k: string; def: string }) {
  const design = useEngineStore((s) => s.design);
  const apply = useEngineStore((s) => s.apply);
  const sel = design?.choices?.[unitKeyFor(k)] ?? def;
  return (
    <select
      value={sel}
      title="display/entry unit for this field"
      style={{ padding: "1px 2px", minWidth: 0 }}
      onChange={(e) => void apply(unitKeyFor(k), e.target.value)}
    >
      {DIMS[dim].units.map((u) => (
        <option key={u.label} value={u.label}>{u.label}</option>
      ))}
    </select>
  );
}

/**
 * A persisted numeric design input bound to `design.params["<key>"]`.
 * Edits commit through `set_field` (on blur / Enter) so they are saved with the
 * design and re-resolve live; the study reads the value with a physical default.
 *
 * When `dim` is given, a per-field unit dropdown appears: the stored value stays
 * in `baseUnit` (the unit the backend reads, e.g. the key's suffix), while the
 * field displays/accepts the user's chosen unit. The chosen unit persists under
 * `unit.<k>` and travels with the saved design; `min`/`max` are in `baseUnit`.
 */
export function ParamField({ label, k, def, step = 1, unit, hint, min, max, dim, baseUnit }: { label: string; k: string; def: number; step?: number; unit?: string; hint?: string; min?: number; max?: number; dim?: Dim; baseUnit?: string }) {
  const design = useEngineStore((s) => s.design);
  const apply = useEngineStore((s) => s.apply);
  const stored = design?.params?.[k];
  const value = stored === undefined ? def : stored; // in baseUnit (or raw)

  // Unit conversion (only when a dimension is declared). The stored value is in
  // `baseUnit`; convert through SI to the user's selected display unit.
  const base = dim ? unitOf(dim, baseUnit ?? DIMS[dim].base) : null;
  const selLabel = dim ? (design?.choices?.[unitKeyFor(k)] ?? baseUnit ?? DIMS[dim].base) : undefined;
  const selU = dim ? unitOf(dim, selLabel) : null;
  const toDisplay = (storeVal: number) => (base && selU ? Number(selU.fromSI(base.toSI(storeVal)).toFixed(selU.decimals)) : storeVal);
  const toStore = (dispVal: number) => (base && selU ? base.fromSI(selU.toSI(dispVal)) : dispVal);

  const [text, setText] = useState(String(toDisplay(value)));
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setText(String(toDisplay(value)));
    setErr(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, selLabel]);

  const commit = () => {
    const t = text.trim();
    // Bad input is reported, not silently swallowed (report option #19).
    if (t === "") { setErr("enter a number"); return; }
    const d = Number(t);
    if (isNaN(d)) { setErr("enter a number"); return; }
    const n = toStore(d);
    if (min !== undefined && n < min - 1e-12) { setErr(`must be ≥ ${Number(toDisplay(min))}`); return; }
    if (max !== undefined && n > max + 1e-12) { setErr(`must be ≤ ${Number(toDisplay(max))}`); return; }
    setErr(null);
    if (Math.abs(n - value) > Math.abs(value) * 1e-9 + 1e-12) void apply(k, n);
    else setText(String(toDisplay(value)));
  };

  const isCustom = stored !== undefined && stored !== def;
  return (
    <label className="qt-field" title={hint}>
      <span>
        {label}
        {!dim && unit ? ` (${unit})` : ""}
        {isCustom ? <span style={{ color: "#3574e0", marginLeft: 4 }} title="custom value (default shown on reset)">●</span> : null}
      </span>
      <span style={{ display: "inline-flex", gap: 4, alignItems: "flex-start" }}>
        <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 1 }}>
          <input
            type="number"
            step={step}
            value={text}
            title={hint}
            style={err ? { borderColor: "#c23b34" } : undefined}
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          />
          {err && <span style={{ color: "#c23b34", fontSize: 10 }}>{err}</span>}
        </span>
        {dim && <UnitSelect dim={dim} k={k} def={baseUnit ?? DIMS[dim].base} />}
      </span>
    </label>
  );
}

/**
 * A presentational numeric input with a per-field unit dropdown that exchanges
 * SI with the caller: `value` is SI, `onCommit` receives SI. The chosen unit
 * persists under `unit.<unitKey>` and travels with the saved design. Use this
 * for the core requirement inputs (thrust, pressure, …) where the design stores
 * SI directly. `min`/`max` are in SI; `emptyWhenZero` mirrors CommitNumberField.
 */
export function UnitNumberField({
  value,
  dim,
  unitKey,
  defUnit,
  onCommit,
  step = 1,
  min,
  max,
  placeholder,
  emptyWhenZero = false,
  hint,
}: {
  value: number;
  dim: Dim;
  unitKey: string;
  defUnit: string;
  onCommit: (si: number) => void;
  step?: number;
  min?: number;
  max?: number;
  placeholder?: string;
  emptyWhenZero?: boolean;
  hint?: string;
}) {
  const design = useEngineStore((s) => s.design);
  const apply = useEngineStore((s) => s.apply);
  const selLabel = design?.choices?.[unitKeyFor(unitKey)] ?? defUnit;
  const u = unitOf(dim, selLabel);

  const display = emptyWhenZero && !(value > 0) ? "" : String(Number(u.fromSI(value).toFixed(u.decimals)));
  const [text, setText] = useState(display);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setText(display);
    setErr(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [display, selLabel]);

  const commit = () => {
    const t = text.trim();
    if (t === "") {
      if (emptyWhenZero) { if (value !== 0) onCommit(0); } else setText(display);
      setErr(null);
      return;
    }
    const n = Number(t);
    if (isNaN(n)) { setErr("enter a number"); return; }
    const si = u.toSI(n);
    if (!(emptyWhenZero && n === 0)) {
      if (min !== undefined && si < min - 1e-9) { setErr(`must be ≥ ${Number(u.fromSI(min).toFixed(u.decimals))}`); return; }
      if (max !== undefined && si > max + 1e-9) { setErr(`must be ≤ ${Number(u.fromSI(max).toFixed(u.decimals))}`); return; }
    }
    setErr(null);
    if (Math.abs(si - value) > Math.abs(value) * 1e-9 + 1e-12) onCommit(si);
  };

  return (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "flex-start" }} title={hint}>
      <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 1 }}>
        <input
          type="number"
          step={step}
          placeholder={placeholder}
          value={text}
          style={err ? { borderColor: "#c23b34" } : undefined}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        />
        {err && <span style={{ color: "#c23b34", fontSize: 10 }}>{err}</span>}
      </span>
      <select
        value={selLabel}
        title="display/entry unit for this field"
        style={{ padding: "1px 2px", minWidth: 0 }}
        onChange={(e) => void apply(unitKeyFor(unitKey), e.target.value)}
      >
        {DIMS[dim].units.map((uu) => (
          <option key={uu.label} value={uu.label}>{uu.label}</option>
        ))}
      </select>
    </span>
  );
}

/**
 * A numeric input that commits on blur / Enter (never per-keystroke), so an
 * async re-resolve can't revert a half-typed value to its first digit. Re-syncs
 * to `value` whenever the design changes. Presentational — the caller supplies
 * `onCommit` and any unit conversion (e.g. bar → Pa).
 *
 * `emptyWhenZero` shows a blank field (with `placeholder`) while the value is 0,
 * and commits 0 when the field is cleared — used for "not yet entered" inputs.
 */
export function CommitNumberField({
  value,
  onCommit,
  step = 1,
  placeholder,
  emptyWhenZero = false,
  displayDecimals,
  min,
  max,
  hint,
}: {
  value: number;
  onCommit: (n: number) => void;
  step?: number;
  placeholder?: string;
  emptyWhenZero?: boolean;
  displayDecimals?: number;
  min?: number;
  max?: number;
  hint?: string;
}) {
  const display =
    emptyWhenZero && !(value > 0)
      ? ""
      : displayDecimals !== undefined
        ? String(Number(value.toFixed(displayDecimals)))
        : String(value);
  const [text, setText] = useState(display);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setText(display);
    setErr(null);
  }, [display]);

  const commit = () => {
    const t = text.trim();
    if (t === "") {
      // Blank clears the field (unconfigures) when that is allowed.
      if (emptyWhenZero) { if (value !== 0) onCommit(0); } else setText(display);
      setErr(null);
      return;
    }
    const n = Number(t);
    if (isNaN(n)) { setErr("enter a number"); return; }
    if (!(emptyWhenZero && n === 0)) {
      if (min !== undefined && n < min) { setErr(`must be ≥ ${min}`); return; }
      if (max !== undefined && n > max) { setErr(`must be ≤ ${max}`); return; }
    }
    setErr(null);
    if (n !== value) onCommit(n);
  };

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 1 }}>
      <input
        type="number"
        step={step}
        placeholder={placeholder}
        value={text}
        title={hint}
        style={err ? { borderColor: "#c23b34" } : undefined}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
      {err && <span style={{ color: "#c23b34", fontSize: 10 }}>{err}</span>}
    </span>
  );
}

/** A persisted text choice bound to `design.choices["<key>"]`. */
export function ParamChoice({ label, k, def, options, hint }: { label: string; k: string; def: string; options: string[]; hint?: string }) {
  const design = useEngineStore((s) => s.design);
  const apply = useEngineStore((s) => s.apply);
  const value = design?.choices?.[k] ?? def;
  return (
    <label className="qt-field" title={hint}>
      <span>{label}</span>
      <select value={value} onChange={(e) => void apply(k, e.target.value)}>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </label>
  );
}

/** Reset every design param/choice whose key starts with `prefix` to defaults. */
export function ResetParams({ prefix }: { prefix: string }) {
  const design = useEngineStore((s) => s.design);
  const apply = useEngineStore((s) => s.apply);
  const hasCustom =
    Object.keys(design?.params ?? {}).some((k) => k.startsWith(prefix)) ||
    Object.keys(design?.choices ?? {}).some((k) => k.startsWith(prefix));
  if (!hasCustom) return null;
  return (
    <button
      className="qt-tool"
      title="Clear custom values for this subsystem (revert to defaults)"
      onClick={async () => {
        // Re-apply defaults by clearing: send the sentinel and let studies fall back.
        for (const key of Object.keys(design?.params ?? {}).filter((k) => k.startsWith(prefix))) {
          await apply(key, "__reset__");
        }
        for (const key of Object.keys(design?.choices ?? {}).filter((k) => k.startsWith(prefix))) {
          await apply(key, "__reset__");
        }
      }}
    >
      Reset to defaults
    </button>
  );
}
