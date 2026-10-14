import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PerfMapDto } from "./api";

// O/F is an ordered sweep: one hue, light (lean) to deep (rich). Status colours stay for pass/fail.
const RAMP = ["#c4dbf6", "#9cc2ef", "#78a9e6", "#5689cc", "#3b6aa8"];

export function PerfMapChart({ map }: { map: PerfMapDto }) {
  const data = map.alt_axis.map((alt, j) => {
    const row: Record<string, number> = { alt: alt / 1000 };
    map.of_axis.forEach((of, i) => {
      row[`O/F ${of.toFixed(2)}`] = map.isp_matrix[i][j];
    });
    return row;
  });

  const all = map.isp_matrix.flat();
  const summary = all.length
    ? `Specific impulse against altitude for O/F ${map.of_axis.map((o) => o.toFixed(2)).join(", ")}: from ${Math.min(...all).toFixed(0)} s to ${Math.max(...all).toFixed(0)} s between sea level and ${(Math.max(...map.alt_axis) / 1000).toFixed(0)} km.`
    : "No performance map for this design.";
  return (
    <div role="img" aria-label={summary}>
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
        <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
        <XAxis
          dataKey="alt"
          stroke="var(--ink-3)"
          tick={{ fill: "var(--ink-3)", fontSize: 12 }}
          height={38}
          label={{ value: "Altitude (km)", position: "insideBottom", offset: 0, fill: "var(--ink-3)", fontSize: 12 }}
        />
        <YAxis
          stroke="var(--ink-3)"
          tick={{ fill: "var(--ink-3)", fontSize: 12 }}
          label={{ value: "Isp (s)", angle: -90, position: "insideLeft", fill: "var(--ink-3)" }}
        />
        <Tooltip contentStyle={{ background: "var(--bg-2)", border: "1px solid var(--line-2)", borderRadius: 4, fontSize: 12 }} />
        <Legend verticalAlign="top" height={30} wrapperStyle={{ fontSize: 12 }} />
        {map.of_axis.map((of, i) => (
          <Line
            key={of}
            type="monotone"
            dataKey={`O/F ${of.toFixed(2)}`}
            stroke={RAMP[Math.round((i * (RAMP.length - 1)) / Math.max(1, map.of_axis.length - 1))]}
            dot={false}
            strokeWidth={2}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
    </div>
  );
}
