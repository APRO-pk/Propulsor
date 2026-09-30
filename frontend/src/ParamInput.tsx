import { useEffect, useState } from "react";
import { useEngineStore } from "./store";

/**
 * A persisted numeric design input bound to `design.params["<key>"]`.
 * Edits commit through `set_field` (on blur / Enter) so they are saved with the
 * design and re-resolve live; the study reads the value with a physical default.
 */
export function ParamField({ label, k, def, step = 1, unit, hint }: { label: string; k: string; def: number; step?: number; unit?: string; hint?: string }) {
  const design = useEngineStore((s) => s.design);
  const apply = useEngineStore((s) => s.apply);
  const stored = design?.params?.[k];
  const value = stored === undefined ? def : stored;
  const [text, setText] = useState(String(value));

  useEffect(() => {
    setText(String(value));
  }, [value]);

  const commit = () => {
    const n = Number(text);
    if (!isNaN(n) && n !== value) void apply(k, n);
    else setText(String(value));
  };

  const isCustom = stored !== undefined && stored !== def;
  return (
    <label className="qt-field" title={hint}>
      <span>
        {label}
        {unit ? ` (${unit})` : ""}
        {isCustom ? <span style={{ color: "#3574e0", marginLeft: 4 }} title="custom value (default shown on reset)">●</span> : null}
      </span>
      <input
        type="number"
        step={step}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      />
    </label>
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
