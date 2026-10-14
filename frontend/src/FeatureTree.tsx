import { useMemo, useRef, useState } from "react";

export type NodeStatus = "ok" | "warn" | "fail" | "none";

export interface TreeLeaf {
  id: string;
  label: string;
}
export interface TreeGroup {
  group: string;
  label: string;
  children: TreeLeaf[];
}
export type TreeEntry = TreeLeaf | TreeGroup;

const isGroup = (e: TreeEntry): e is TreeGroup => "group" in e;

interface Row {
  key: string;
  label: string;
  level: number;
  group?: TreeGroup;
  leaf?: TreeLeaf;
  parent?: string;
}

/**
 * The engine as a CAD-style feature tree: parts grouped by assembly, each with
 * its solve status. A WAI-ARIA tree — arrows move, Right/Left expand and
 * collapse, Home/End jump, Enter or Space opens the part.
 */
export function FeatureTree({
  entries,
  selected,
  status,
  onSelect,
}: {
  entries: TreeEntry[];
  selected: string;
  status: (id: string) => NodeStatus;
  onSelect: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [focusKey, setFocusKey] = useState<string>(selected);
  const listRef = useRef<HTMLUListElement>(null);

  const q = filter.trim().toLowerCase();
  const rows = useMemo(() => {
    const out: Row[] = [];
    for (const e of entries) {
      if (isGroup(e)) {
        const kids = q ? e.children.filter((c) => c.label.toLowerCase().includes(q) || e.label.toLowerCase().includes(q)) : e.children;
        if (q && kids.length === 0) continue;
        out.push({ key: `g:${e.group}`, label: e.label, level: 1, group: e });
        if (q || !collapsed.has(e.group)) for (const c of kids) out.push({ key: c.id, label: c.label, level: 2, leaf: c, parent: `g:${e.group}` });
      } else if (!q || e.label.toLowerCase().includes(q)) {
        out.push({ key: e.id, label: e.label, level: 1, leaf: e });
      }
    }
    return out;
  }, [entries, collapsed, q]);

  const activeKey = rows.some((r) => r.key === focusKey) ? focusKey : rows.find((r) => r.key === selected)?.key ?? rows[0]?.key;

  const focusRow = (key: string) => {
    setFocusKey(key);
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.focus());
  };
  const toggle = (g: string, open?: boolean) =>
    setCollapsed((s) => {
      const n = new Set(s);
      const isOpen = !n.has(g);
      if (open === undefined ? isOpen : !open) n.add(g);
      else n.delete(g);
      return n;
    });

  const onKey = (e: React.KeyboardEvent, row: Row) => {
    const i = rows.findIndex((r) => r.key === row.key);
    const groupOpen = row.group ? q !== "" || !collapsed.has(row.group.group) : false;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (i < rows.length - 1) focusRow(rows[i + 1].key);
        break;
      case "ArrowUp":
        e.preventDefault();
        if (i > 0) focusRow(rows[i - 1].key);
        break;
      case "Home":
        e.preventDefault();
        focusRow(rows[0].key);
        break;
      case "End":
        e.preventDefault();
        focusRow(rows[rows.length - 1].key);
        break;
      case "ArrowRight":
        e.preventDefault();
        if (row.group) {
          if (!groupOpen) toggle(row.group.group, true);
          else if (rows[i + 1]?.parent === row.key) focusRow(rows[i + 1].key);
        }
        break;
      case "ArrowLeft":
        e.preventDefault();
        if (row.group && groupOpen) toggle(row.group.group, false);
        else if (row.parent) focusRow(row.parent);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (row.leaf) onSelect(row.leaf.id);
        else if (row.group) toggle(row.group.group);
        break;
    }
  };

  // Render nested markup (treeitem groups own their children) from the flat rows.
  const renderRows = () => {
    const out: JSX.Element[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.parent) continue;
      if (r.group) {
        const kids = rows.filter((k) => k.parent === r.key);
        const open = q !== "" || !collapsed.has(r.group.group);
        out.push(
          <li
            key={r.key}
            role="treeitem"
            aria-level={1}
            aria-expanded={open}
            aria-selected={false}
            tabIndex={activeKey === r.key ? 0 : -1}
            data-key={r.key}
            className="ti-group"
            onKeyDown={(e) => e.target === e.currentTarget && onKey(e, r)}
            onFocus={(e) => e.target === e.currentTarget && setFocusKey(r.key)}
          >
            <div className="ti-row" style={{ ["--lvl" as string]: 0 } as React.CSSProperties} onClick={() => { toggle(r.group!.group); setFocusKey(r.key); }}>
              <span className="ti-caret" aria-hidden="true">
                <svg width="9" height="9" viewBox="0 0 10 10"><path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
              </span>
              <span className="ti-label">{r.label}</span>
            </div>
            {open && kids.length > 0 && (
              <ul role="group">
                {kids.map((k) => leafItem(k, 2))}
              </ul>
            )}
          </li>,
        );
      } else out.push(leafItem(r, 1));
    }
    return out;
  };

  function leafItem(r: Row, level: number) {
    const st = status(r.leaf!.id);
    const sel = selected === r.leaf!.id;
    return (
      <li
        key={r.key}
        role="treeitem"
        aria-level={level}
        aria-selected={sel}
        tabIndex={activeKey === r.key ? 0 : -1}
        data-key={r.key}
        onKeyDown={(e) => e.target === e.currentTarget && onKey(e, r)}
        onFocus={(e) => e.target === e.currentTarget && setFocusKey(r.key)}
      >
        <div className="ti-row" style={{ ["--lvl" as string]: level - 1 } as React.CSSProperties} onClick={() => { onSelect(r.leaf!.id); setFocusKey(r.key); }}>
          <span className="ti-caret" aria-hidden="true" />
          <span className="ti-label">{r.label}</span>
          <span className={`ti-status ${st}`} role="img" aria-label={STATUS_LABEL[st]} />
        </div>
      </li>
    );
  }

  return (
    <>
      <label className="tree-filter">
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M10.5 10.5l3 3" stroke="currentColor" strokeWidth="1.4" /></svg>
        <span className="sr-only">Find a part</span>
        <input type="search" placeholder="Find a part" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </label>
      <ul className="tree-list" role="tree" aria-label="Engine parts" ref={listRef}>
        {renderRows()}
        {rows.length === 0 && <li className="muted" style={{ padding: "8px 14px" }}>No part matches “{filter}”.</li>}
      </ul>
    </>
  );
}

const STATUS_LABEL: Record<NodeStatus, string> = {
  ok: "solved",
  warn: "advisory",
  fail: "failed check",
  none: "not solved yet",
};
