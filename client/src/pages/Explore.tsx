import { useEffect, useState } from "react"
import { api } from "@/api"
import type { GenreStat } from "@/api"
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  CartesianGrid, ResponsiveContainer, Cell,
} from "recharts"

function interpolateColor(value: number): string {
  const r = Math.round(239 * value + 59 * (1 - value))
  const g = Math.round(68  * value + 130 * (1 - value))
  const b = Math.round(68  * value + 246 * (1 - value))
  return `rgb(${r},${g},${b})`
}

export function Explore() {
  const [genres, setGenres] = useState<GenreStat[]>([])
  const [loading, setLoading] = useState(true)
  const [metric, setMetric] = useState<"avg_tension" | "avg_sentiment" | "avg_pacing">("avg_tension")

  useEffect(() => {
    api.genres()
      .then(data => { setGenres(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const sorted = [...genres].sort((a, b) => b[metric] - a[metric]).slice(0, 15)
  const max = sorted.length ? sorted[0][metric] : 1

  const metrics = [
    { key: "avg_tension",   label: "Intensity" },
    { key: "avg_sentiment", label: "Mood"      },
    { key: "avg_pacing",    label: "Pace"      },
  ] as const

  return (
    <div className="max-w-5xl mx-auto px-6 py-10 space-y-8">
      <div>
        <p className="label mb-2">Explore</p>
        <h1 className="font-serif text-4xl text-text">Genre Fingerprints</h1>
        <p className="mt-2 text-subtle max-w-lg">
          Which genres keep you on the edge of your seat? Which ones leave you uplifted? See how stories feel, by subject.
        </p>
      </div>

      {/* Metric toggle */}
      <div className="flex gap-1 bg-surface border border-border rounded-lg p-1 w-fit">
        {metrics.map(m => (
          <button
            key={m.key}
            onClick={() => setMetric(m.key)}
            className={`px-4 py-1.5 rounded-md text-sm transition-colors ${
              metric === m.key
                ? "bg-muted text-text"
                : "text-subtle hover:text-text"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Chart */}
      {loading ? (
        <div className="card h-96 animate-pulse" />
      ) : sorted.length === 0 ? (
        <div className="card p-10 text-center text-subtle">
          No genre data yet — run the pipeline to populate.
        </div>
      ) : (
        <div className="card p-5">
          <ResponsiveContainer width="100%" height={420}>
            <BarChart
              data={sorted}
              layout="vertical"
              margin={{ top: 0, right: 20, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#1c1c28" horizontal={false} />
              <XAxis
                type="number"
                domain={[0, 1]}
                tickFormatter={v => `${(v * 100).toFixed(0)}%`}
                tick={{ fill: "#6b6b80", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="subject"
                width={160}
                tick={{ fill: "#e8e6e3", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={v => v.length > 24 ? v.slice(0, 24) + "…" : v}
              />
              <Tooltip
                cursor={{ fill: "#1c1c28" }}
                contentStyle={{ background: "#111118", border: "1px solid #1c1c28", borderRadius: 8, fontSize: 12 }}
                formatter={(v) => [`${(Number(v) * 100).toFixed(1)}%`, metrics.find(m => m.key === metric)?.label ?? metric]}
              />
              <Bar dataKey={metric} radius={[0, 4, 4, 0]}>
                {sorted.map((entry, i) => (
                  <Cell
                    key={i}
                    fill={interpolateColor(entry[metric] / max)}
                    fillOpacity={0.85}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Table */}
      {!loading && sorted.length > 0 && (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left p-4 label">Genre</th>
                <th className="text-right p-4 label">Intensity</th>
                <th className="text-right p-4 label">Mood</th>
                <th className="text-right p-4 label">Pace</th>
                <th className="text-right p-4 label">Titles</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((g, i) => (
                <tr key={i} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                  <td className="p-4 text-text">{g.subject}</td>
                  <td className="p-4 text-right" style={{ color: interpolateColor(g.avg_tension) }}>
                    {(g.avg_tension * 100).toFixed(1)}%
                  </td>
                  <td className="p-4 text-right" style={{ color: g.avg_sentiment >= 0 ? "#22c55e" : "#ef4444" }}>
                    {g.avg_sentiment >= 0 ? "+" : ""}{(g.avg_sentiment * 100).toFixed(1)}%
                  </td>
                  <td className="p-4 text-right text-calm">
                    {(g.avg_pacing * 100).toFixed(1)}%
                  </td>
                  <td className="p-4 text-right text-subtle">{g.book_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
