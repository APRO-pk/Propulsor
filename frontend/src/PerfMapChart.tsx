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

export function PerfMapChart({ map }: { map: PerfMapDto }) {
  const data = map.alt_axis.map((alt, j) => {
    const row: Record<string, number> = { alt: alt / 1000 };
    map.of_axis.forEach((of, i) => {
      row[`O/F ${of.toFixed(2)}`] = map.isp_matrix[i][j];
    });
    return row;
  });

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
        <CartesianGrid stroke="#dcdce2" strokeDasharray="3 3" />
        <XAxis
          dataKey="alt"
          stroke="#6b7280"
          tick={{ fill: "#6b7280", fontSize: 12 }}
          label={{ value: "Altitude (km)", position: "insideBottom", offset: -6, fill: "#6b7280" }}
        />
        <YAxis
          stroke="#6b7280"
          tick={{ fill: "#6b7280", fontSize: 12 }}
          label={{ value: "Isp (s)", angle: -90, position: "insideLeft", fill: "#6b7280" }}
        />
        <Tooltip contentStyle={{ background: "#ffffff", border: "1px solid #b9bcc4", borderRadius: 4, fontSize: 12 }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {map.of_axis.map((of, i) => (
          <Line
            key={of}
            type="monotone"
            dataKey={`O/F ${of.toFixed(2)}`}
            stroke={["#3574e0", "#c47b12", "#2f8f46", "#c23b34", "#7a5bd0"][i % 5]}
            dot={false}
            strokeWidth={2}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
