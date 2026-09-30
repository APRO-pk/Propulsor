//! Test-stand & safety tools: P&ID generator and firing/abort checklist.
//!
//! These are text/SVG deliverables pulled from Krzycki's feed-system, test-stand,
//! and safety sections (§6 of the spec). They are generated from the design model
//! so the report/range-approval package can be produced with one click.

use engine_core::EngineDesign;

/// Generate an ignition / shutdown / abort checklist (pre-fire + firing procedure).
pub fn safety_checklist(design: &EngineDesign) -> String {
    let name = &design.meta.name;
    format!(
        "PROPULSOR — FIRING CHECKLIST\n\
         Engine: {name}\n\
         Propellant: {}\n\
         ================================\n\
         \n\
         PRE-FIRE\n\
         1. Barricade distance verified (>= 100 ft / 30 m clear).\n\
         2. All personnel clear of the firing line; abort switch armed.\n\
         3. Propellant tanks pressurized to operating pressure; check for leaks.\n\
         4. Water coolant flow verified through the jacket.\n\
         5. Purge (GN2/helium) line verified clear.\n\
         6. Igniter (hot-source) checked; voltage and continuity confirmed.\n\
         7. Data acquisition channels all nominal.\n\
         \n\
         IGNITION\n\
         8. Start purge; open main fuel valve (lead).\n\
         9. Fire igniter; confirm flame presence within ignition delay.\n\
         10. Open oxidizer valve; verify smooth chamber-pressure rise.\n\
         11. Monitor for hard start (rapid Pc spike) — abort immediately if > 2x Pc.\n\
         12. Hold for steady-state; log Pc, thrust, coolant ΔT.\n\
         \n\
         SHUTDOWN\n\
         13. Close oxidizer valve; close fuel valve.\n\
         14. Post-firing purge; clear residual propellants.\n\
         15. Vent tanks; depressurize lines.\n\
         16. Cool-down water; secure test stand.\n\
         \n\
         ABORT (ANY TIME)\n\
         17. Cut main propellant valves; fire purge.\n\
         18. If propellant leak detected: stop flow, vent, evacuate.\n",
        design.propellant.pair.label(),
    )
}

/// Generate a simple SVG P&ID schematic of the feed system.
pub fn pid_svg(design: &EngineDesign) -> String {
    let name = &design.meta.name;
    format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="820" height="360" viewBox="0 0 820 360">
  <style>text{{font-family:monospace;font-size:12px;fill:#e6e6ea}} .box{{fill:#17171f;stroke:#ff7a1a;stroke-width:1.5}} .pipe{{stroke:#8a8a96;stroke-width:2}} .lbl{{fill:#8a8a96}}</style>
  <text x="20" y="24" font-size="14">P&amp;ID — {name}</text>

  <!-- fuel tank -->
  <rect class="box" x="60" y="120" width="90" height="70" rx="6"/>
  <text x="105" y="160" text-anchor="middle">FUEL TANK</text>
  <path class="pipe" d="M150 155 H240"/>

  <!-- fuel regulator -->
  <rect class="box" x="240" y="130" width="70" height="40" rx="4"/>
  <text x="275" y="154" text-anchor="middle">REG</text>
  <path class="pipe" d="M310 150 H400"/>

  <!-- fuel valve -->
  <rect class="box" x="400" y="130" width="60" height="40" rx="4"/>
  <text x="430" y="154" text-anchor="middle">VLV</text>
  <path class="pipe" d="M460 150 H560"/>

  <!-- injector -->
  <rect class="box" x="560" y="120" width="80" height="70" rx="6"/>
  <text x="600" y="160" text-anchor="middle">INJECTOR</text>
  <path class="pipe" d="M560 155 H470 V210 H260 V155"/>

  <!-- ox tank -->
  <rect class="box" x="600" y="260" width="90" height="70" rx="6"/>
  <text x="645" y="300" text-anchor="middle">OX TANK</text>
  <path class="pipe" d="M600 295 H500"/>
  <rect class="box" x="460" y="270" width="70" height="40" rx="4"/>
  <text x="495" y="294" text-anchor="middle">REG</text>
  <path class="pipe" d="M460 290 H360"/>
  <rect class="box" x="300" y="270" width="60" height="40" rx="4"/>
  <text x="330" y="294" text-anchor="middle">VLV</text>
  <path class="pipe" d="M300 290 H470 V210"/>

  <!-- purge -->
  <rect class="box" x="80" y="260" width="90" height="40" rx="4"/>
  <text x="125" y="284" text-anchor="middle">PURGE GN2</text>
  <path class="pipe" stroke-dasharray="4 3" d="M170 280 H420 V150 H400"/>

  <!-- chamber/nozzle -->
  <rect class="box" x="560" y="120" width="0" height="0"/>
  <text class="lbl" x="560" y="230">→ CHAMBER / NOZZLE</text>
</svg>"#,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checklist_contains_firing_steps() {
        let d = sizing_l0::krzycki_golden_design();
        let c = safety_checklist(&d);
        assert!(c.contains("PRE-FIRE"));
        assert!(c.contains("IGNITION"));
        assert!(c.contains("SHUTDOWN"));
        assert!(c.contains("ABORT"));
    }

    #[test]
    fn pid_is_svg() {
        let d = sizing_l0::krzycki_golden_design();
        let svg = pid_svg(&d);
        assert!(svg.trim_start().starts_with("<svg"));
    }
}
