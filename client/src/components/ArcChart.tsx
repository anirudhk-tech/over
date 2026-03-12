import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  CartesianGrid, ReferenceLine, ResponsiveContainer, Legend,
} from "recharts"
import type { ArcPoint } from "@/api"

interface Props {
  data: ArcPoint[]
  showSentiment?: boolean
  showPacing?: boolean
  color?: string
  bookTitle?: string
}

function ChapterTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const d: ArcPoint = payload[0]?.payload
  return (
    <div className="bg-surface border border-border rounded-md p-3 text-xs space-y-1 shadow-xl">
      {d.chapter && <div className="font-medium text-text">{d.chapter}</div>}
      <div className="text-subtle">{(d.position_pct * 100).toFixed(1)}% through book</div>
      <div className="pt-1 space-y-0.5">
        <div className="flex justify-between gap-4">
          <span className="text-subtle">Intensity</span>
          <span style={{ color: "#ef4444" }} className="font-medium">{(d.tension_score * 100).toFixed(0)}%</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-subtle">Mood</span>
          <span style={{ color: d.sentiment_score >= 0 ? "#22c55e" : "#ef4444" }}>
            {d.sentiment_score >= 0 ? "+" : ""}{(d.sentiment_score * 100).toFixed(0)}%
          </span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-subtle">Pace</span>
          <span style={{ color: "#a78bfa" }}>{(d.pacing_score * 100).toFixed(0)}%</span>
        </div>
      </div>
      {d.dominant_characters?.length > 0 && (
        <div className="pt-1 border-t border-border text-subtle">
          {d.dominant_characters.slice(0, 3).join(", ")}
        </div>
      )}
    </div>
  )
}

export function ArcChart({ data, showSentiment = true, showPacing = false, color = "#ef4444" }: Props) {
  if (!data.length) return (
    <div className="h-64 flex items-center justify-center text-subtle text-sm">
      No arc data yet
    </div>
  )

  // Chapter boundaries for reference lines
  const chapterLines = data.filter(d => d.chapter)

  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id={`tension-${color.replace("#","")}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={color} stopOpacity={0.3} />
            <stop offset="95%" stopColor={color} stopOpacity={0}   />
          </linearGradient>
          <linearGradient id="sentiment-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#22c55e" stopOpacity={0.2} />
            <stop offset="95%" stopColor="#22c55e" stopOpacity={0}   />
          </linearGradient>
        </defs>

        <CartesianGrid strokeDasharray="3 3" stroke="#1c1c28" vertical={false} />

        {/* Chapter reference lines */}
        {chapterLines.map((d, i) => (
          <ReferenceLine
            key={i}
            x={d.position_pct}
            stroke="#2a2a3a"
            strokeDasharray="4 4"
          />
        ))}

        <XAxis
          dataKey="position_pct"
          tickFormatter={v => `${(v * 100).toFixed(0)}%`}
          tick={{ fill: "#6b6b80", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          domain={[0, 1]}
          tickFormatter={v => `${(v * 100).toFixed(0)}`}
          tick={{ fill: "#6b6b80", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />

        <Tooltip content={<ChapterTooltip />} />

        {showSentiment && (
          <Area
            type="monotone"
            dataKey="sentiment_score"
            stroke="#22c55e"
            strokeWidth={1}
            fill="url(#sentiment-grad)"
            dot={false}
            name="Mood"
          />
        )}

        {showPacing && (
          <Area
            type="monotone"
            dataKey="pacing_score"
            stroke="#a78bfa"
            strokeWidth={1}
            fill="none"
            dot={false}
            name="Pace"
          />
        )}

        <Area
          type="monotone"
          dataKey="tension_score"
          stroke={color}
          strokeWidth={2}
          fill={`url(#tension-${color.replace("#","")})`}
          dot={false}
          name="Intensity"
        />

        <Legend
          wrapperStyle={{ fontSize: 11, color: "#6b6b80", paddingTop: 8 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
