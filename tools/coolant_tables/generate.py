"""Generate crates/cooling/src/coolant_tables.rs — temperature-dependent
regenerative-coolant property tables.

Sources (downloaded at run time, so every number is traceable):
  * RocketProps (C. Taylor), github.com/sonofeft/RocketProps — saturated-liquid
    tables (T, SG, log10 viscosity, conductivity, cp) from the freezing point to
    the critical point, plus Tc / Pc / Tnbp.  Water, LOX, CH4, para-H2, ethanol,
    methanol, propane and N2O are REFPROP-derived; RP-1, MMH, UDMH, NTO, H2O2 are
    RocketProps' compiled data.
  * NIST Chemistry WebBook fluid data (REFPROP equations of state),
    webbook.nist.gov/chemistry/fluid — isobaric tables at supercritical
    pressures for para-H2, CH4, O2, propane and N2O, and the saturated-liquid
    table for n-heptane (the gasoline surrogate, absent from RocketProps); methanol
    and n-heptane isobars too (NIST has no ethanol data).

Usage:  python tools/coolant_tables/generate.py > crates/cooling/src/coolant_tables.rs
"""

import re
import sys
import time
import urllib.error
import urllib.request

ROCKETPROPS = "https://raw.githubusercontent.com/sonofeft/RocketProps/master/rocketprops/props/{}_prop.py"
NIST = (
    "https://webbook.nist.gov/cgi/fluid.cgi?Action=Data&Wide=on&ID={id}&Type={type}&Digits=6"
    "&P={p}&THigh={thi}&TLow={tlo}&TInc={tinc}&RefState=DEF&TUnit=K&PUnit=MPa&DUnit=kg%2Fm3"
    "&HUnit=kJ%2Fkg&WUnit=m%2Fs&VisUnit=Pa*s&STUnit=N%2Fm"
)

R_TO_K = 5.0 / 9.0
PSI_TO_PA = 6894.757293168
COND_TO_SI = 1.730734908  # BTU/(hr·ft·°F) → W/(m·K)
CP_TO_SI = 4186.8  # BTU/(lbm·°F) → J/(kg·K)


def fetch(url):
    for attempt in range(4):
        try:
            # NIST rejects urllib's default user agent.
            req = urllib.request.Request(url, headers={"User-Agent": "coolant-table-generator/1.0"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read().decode("utf-8")
        except urllib.error.HTTPError as e:
            if e.code == 400:  # NIST "Range Error": outside the equation of state
                return e.read().decode("utf-8", "replace")
            time.sleep(2.0 * (attempt + 1))
        except Exception:  # transient network errors: back off and retry
            time.sleep(2.0 * (attempt + 1))
    raise RuntimeError(f"failed to fetch {url}")


def rocketprops(name):
    """Saturated-liquid table + critical constants, converted to SI."""
    src = fetch(ROCKETPROPS.format(name))
    vals = {}
    for m in re.finditer(r"self\.(\w+)\s*=\s*(\[[^\]]*\]|[-+0-9.eE]+)", src):
        key, raw = m.group(1), m.group(2)
        if key in vals:
            continue
        vals[key] = eval(raw)  # plain numeric literals / lists only
    t = [x * R_TO_K for x in vals["tL"]]
    rho = [sg * 1000.0 for sg in vals["SG_liqL"]]
    mu = [10.0 ** lv * 0.1 for lv in vals["log10viscL"]]
    k = [c * COND_TO_SI for c in vals["condL"]]
    cp = [c * CP_TO_SI for c in vals["cpL"]]
    h = [0.0]
    for i in range(1, len(t)):  # trapezoidal ∫cp dT (only differences are used)
        h.append(h[-1] + 0.5 * (cp[i] + cp[i - 1]) * (t[i] - t[i - 1]))
    consts = dict(tc=vals["Tc"] * R_TO_K, pc=vals["Pc"] * PSI_TO_PA, tnbp=vals["Tnbp"] * R_TO_K)
    return consts, dict(t=t, rho=rho, mu=mu, k=k, cp=cp, h=h)


def nist_rows(fluid_id, typ, p_mpa, segments):
    """Rows of a NIST table over piecewise-uniform temperature segments."""
    rows, seen = [], set()
    for tlo, thi, tinc in segments:
        text = fetch(NIST.format(id=fluid_id, type=typ, p=p_mpa, tlo=tlo, thi=thi, tinc=tinc))
        if text.startswith("Range Error"):
            sys.stderr.write(f"{fluid_id} @ {p_mpa} MPa: no data for {tlo}-{thi} K (outside the EOS range)\n")
            continue
        lines = text.strip().splitlines()
        header = lines[0].split("\t")
        for line in lines[1:]:
            cells = dict(zip(header, line.split("\t")))
            t = float(cells["Temperature (K)"])
            if t in seen:
                continue
            seen.add(t)
            rows.append(cells)
        time.sleep(0.5)
    rows.sort(key=lambda c: float(c["Temperature (K)"]))
    return rows


def nist_isobar(fluid_id, p_mpa, segments):
    rows = nist_rows(fluid_id, "IsoBar", p_mpa, segments)
    # Drop rows outside the transport-property models' range ("undefined").
    needed = ("Density (kg/m3)", "Viscosity (Pa*s)", "Therm. Cond. (W/m*K)", "Cp (J/g*K)", "Enthalpy (kJ/kg)")
    bad = [r["Temperature (K)"] for r in rows if any(r[c] == "undefined" for c in needed)]
    if bad:
        sys.stderr.write(f"{fluid_id} @ {p_mpa} MPa: dropped undefined rows at T = {', '.join(bad)} K\n")
    rows = [r for r in rows if r["Temperature (K)"] not in bad]
    col = lambda name, scale=1.0: [float(r[name]) * scale for r in rows]
    return dict(
        t=col("Temperature (K)"),
        rho=col("Density (kg/m3)"),
        mu=col("Viscosity (Pa*s)"),
        k=col("Therm. Cond. (W/m*K)"),
        cp=col("Cp (J/g*K)", 1000.0),
        h=col("Enthalpy (kJ/kg)", 1000.0),
    )


def nist_saturated_liquid(fluid_id, grid):
    """NIST returns the whole saturation curve (triple → critical point) for a
    SatT query; keep the first row at or above each grid temperature."""
    rows = nist_rows(fluid_id, "SatT", 0, [(grid[0], grid[-1], grid[1] - grid[0])])
    picked = []
    for target in grid:
        row = next((r for r in rows if float(r["Temperature (K)"]) >= target - 1e-9), None)
        if row is not None and row not in picked:
            picked.append(row)
    # Transport properties are undefined right at the critical point; drop those rows.
    needed = ("Density (l, kg/m3)", "Viscosity (l, Pa*s)", "Therm. Cond. (l, W/m*K)", "Cp (l, J/g*K)")
    rows = [r for r in picked if all(r[c] != "undefined" for c in needed)]
    col = lambda name, scale=1.0: [float(r[name]) * scale for r in rows]
    return dict(
        t=col("Temperature (K)"),
        rho=col("Density (l, kg/m3)"),
        mu=col("Viscosity (l, Pa*s)"),
        k=col("Therm. Cond. (l, W/m*K)"),
        cp=col("Cp (l, J/g*K)", 1000.0),
        h=col("Enthalpy (l, kJ/kg)", 1000.0),
    )


def num(x):
    """A Rust f64 literal (6 significant digits; `%g` drops the `.0` Rust needs)."""
    s = f"{x:.6g}"
    return s if any(c in s for c in ".e") else s + ".0"


def arr(xs):
    return "&[" + ", ".join(num(x) for x in xs) + "]"


def table(tab, p_pa):
    return (
        f"PropTable {{ pressure_pa: {num(p_pa)}, t_k: {arr(tab['t'])}, rho: {arr(tab['rho'])}, "
        f"mu: {arr(tab['mu'])}, k: {arr(tab['k'])}, cp: {arr(tab['cp'])}, h: {arr(tab['h'])} }}"
    )


# (Rust prefix, RocketProps file)
SATURATED = [
    ("WATER", "Water"), ("RP1", "RP1"), ("ETHANOL", "Ethanol"), ("METHANOL", "Methanol"),
    ("METHANE", "Methane"), ("HYDROGEN", "PH2"), ("PROPANE", "Propane"), ("MMH", "MMH"),
    ("UDMH", "UDMH"), ("LOX", "LOX"), ("NTO", "N2O4"), ("PEROXIDE", "H2O2"), ("NITROUS", "N2O"),
]

# Supercritical isobars: (Rust prefix, NIST id, pressures MPa, T segments (lo, hi, step)).
# All isobars of one fluid share the same temperature grid so they can be blended pointwise.
# The lowest isobar sits just above P_crit and the highest covers SSME-class jacket
# pressures, so jacket pressures are interpolated rather than clamped.
SUPERCRITICAL = [
    ("HYDROGEN", "B5000001", [1.4, 2, 4, 8, 16, 32, 50], [(20, 60, 1), (62, 100, 2), (110, 600, 10)]),
    ("METHANE", "C74828", [4.8, 5.5, 8, 12, 20, 35, 50], [(100, 250, 2.5), (260, 800, 20)]),
    ("LOX", "C7782447", [5.2, 6, 10, 15, 25, 40], [(80, 200, 2.5), (210, 700, 20)]),
    ("PROPANE", "C74986", [4.4, 5, 8, 12, 20, 35], [(280, 480, 2.5), (500, 800, 20)]),
    ("NITROUS", "C10024972", [7.5, 8.5, 12, 20, 30, 45], [(280, 400, 2), (410, 700, 10)]),
    ("METHANOL", "C67561", [8.5, 10, 15, 25, 40], [(290, 600, 5), (620, 800, 20)]),
    ("GASOLINE", "C142825", [2.9, 5, 8, 12, 20, 35], [(295, 600, 5), (620, 800, 20)]),
]


def main():
    out = [
        "//! Temperature-dependent regenerative-coolant property tables.",
        "//!",
        "//! GENERATED by `tools/coolant_tables/generate.py` — do not edit by hand.",
        "//! Saturated-liquid tables: RocketProps (REFPROP-derived for water, LOX, CH4,",
        "//! para-H2, ethanol, methanol, propane, N2O; compiled data for RP-1, MMH, UDMH,",
        "//! NTO, H2O2); n-heptane from the NIST WebBook. Supercritical isobars: NIST",
        "//! WebBook (REFPROP). SI units: K, Pa, kg/m³, Pa·s, W/(m·K), J/(kg·K), J/kg",
        "//! (enthalpy only differences are meaningful).",
        "",
        "use crate::coolants::PropTable;",
        "",
    ]
    for prefix, name in SATURATED:
        consts, tab = rocketprops(name)
        out.append(f"pub const {prefix}_TC_K: f64 = {num(consts['tc'])};")
        out.append(f"pub const {prefix}_PC_PA: f64 = {num(consts['pc'])};")
        out.append(f"pub const {prefix}_TNBP_K: f64 = {num(consts['tnbp'])};")
        out.append(f"pub const {prefix}_SAT: PropTable = {table(tab, 0.0)};")
        out.append("")
    # n-heptane: NIST saturated liquid; critical point / NBP from the same source.
    # (NIST n-heptane: saturation curve ends at 540.2 K / 2.7358 MPa; 0.101325 MPa
    # is reached at 371.53 K.)
    hep = nist_saturated_liquid("C142825", [190 + 10 * i for i in range(35)] + [535, 540])
    out.append("pub const GASOLINE_TC_K: f64 = 540.2;")
    out.append("pub const GASOLINE_PC_PA: f64 = 2.7358e6;")
    out.append("pub const GASOLINE_TNBP_K: f64 = 371.53;")
    out.append(f"pub const GASOLINE_SAT: PropTable = {table(hep, 0.0)};")
    out.append("")
    for prefix, fid, pressures, segments in SUPERCRITICAL:
        tabs = [table(nist_isobar(fid, p, segments), p * 1e6) for p in pressures]
        out.append(f"pub const {prefix}_SUPERCRITICAL: [PropTable; {len(tabs)}] = [")
        out.extend(f"    {t}," for t in tabs)
        out.append("];")
        out.append("")
    sys.stdout.reconfigure(encoding="utf-8", newline="\n")  # Windows defaults to cp1252
    sys.stdout.write("\n".join(out) + "\n")


if __name__ == "__main__":
    main()
