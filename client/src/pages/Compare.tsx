import { useEffect, useState } from "react"
import { X, BookMarked } from "lucide-react"
import { api } from "@/api"
import type { Book, ArcPoint } from "@/api"
import { BookCard } from "@/components/BookCard"
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  CartesianGrid, ResponsiveContainer, Legend,
} from "recharts"

const COLORS = ["#ef4444", "#6366f1", "#14b8a6", "#f59e0b"]

function computeStats(arc: ArcPoint[]) {
  if (!arc.length) return { intensity: 0, pace: 0, mood: 0, score: 0 }
  const n = arc.length
  const intensity = arc.reduce((s, d) => s + d.tension_score, 0) / n
  const pace     = arc.reduce((s, d) => s + d.pacing_score, 0) / n
  const mood     = arc.reduce((s, d) => s + d.sentiment_score, 0) / n
  // weighted composite: intensity matters most, then pace, then mood
  const score = intensity * 0.5 + pace * 0.3 + ((mood + 1) / 2) * 0.2
  return { intensity, pace, mood, score }
}

function verdictReason(stats: ReturnType<typeof computeStats>, allStats: ReturnType<typeof computeStats>[]): string {
  const maxIntensity = Math.max(...allStats.map(s => s.intensity))
  const maxPace      = Math.max(...allStats.map(s => s.pace))
  const maxMood      = Math.max(...allStats.map(s => s.mood))

  if (stats.intensity === maxIntensity && stats.pace === maxPace)
    return "the most gripping and fast-paced of the bunch"
  if (stats.intensity === maxIntensity)
    return "it hits the hardest, highest dramatic intensity overall"
  if (stats.pace === maxPace && stats.mood === maxMood)
    return "fast-paced and the most uplifting read of the selection"
  if (stats.pace === maxPace)
    return "it moves the fastest, you won't want to put it down"
  if (stats.mood === maxMood)
    return "the most uplifting arc, ends on the highest note"
  return "the strongest balance of intensity, pace, and mood"
}

interface VerdictProps {
  selected: string[]
  arcs: Record<string, ArcPoint[]>
  titles: Record<string, string>
}

function Verdict({ selected, arcs, titles }: VerdictProps) {
  const withData = selected.filter(id => arcs[id]?.length)
  if (withData.length < 2) return null

  const stats = withData.map(id => ({ id, ...computeStats(arcs[id]) }))
  const allStats = stats.map(s => ({ intensity: s.intensity, pace: s.pace, mood: s.mood, score: s.score }))
  const winner = stats.reduce((best, s) => s.score > best.score ? s : best)
  const winnerIndex = selected.indexOf(winner.id)
  const winnerColor = COLORS[winnerIndex] ?? COLORS[0]
  const reason = verdictReason(winner, allStats)

  return (
    <div className="card p-5 border-accent/30" style={{ borderColor: winnerColor + "40", background: winnerColor + "08" }}>
      <div className="flex items-start gap-4">
        <div className="mt-0.5 shrink-0" style={{ color: winnerColor }}>
          <BookMarked size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="label mb-1">The Verdict</p>
          <p className="font-serif text-2xl text-text leading-snug truncate">
            {titles[winner.id] ?? winner.id}
          </p>
          <p className="mt-1.5 text-subtle text-sm">
            Read this one first! {reason}.
          </p>

          {/* Mini score row */}
          <div className="mt-4 flex flex-wrap gap-4">
            {stats.map((s, i) => (
              <div key={s.id} className="text-xs space-y-0.5">
                <div className="truncate max-w-[120px]" style={{ color: COLORS[selected.indexOf(s.id)] ?? "#6b6b80" }}>
                  {(titles[s.id] ?? s.id).length > 18
                    ? (titles[s.id] ?? s.id).slice(0, 18) + "…"
                    : (titles[s.id] ?? s.id)}
                </div>
                <div className="text-subtle">
                  {(s.score * 100).toFixed(0)}pts · {(s.intensity * 100).toFixed(0)}% intensity · {(s.pace * 100).toFixed(0)}% pace
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function mergeArcs(arcs: Record<string, ArcPoint[]>): any[] {
  const allPositions = Array.from(
    new Set(Object.values(arcs).flatMap(a => a.map(d => d.position_pct)))
  ).sort((a, b) => a - b)

  return allPositions.map(pos => {
    const point: any = { position_pct: pos }
    for (const [bookId, arc] of Object.entries(arcs)) {
      const closest = arc.reduce((prev, curr) =>
        Math.abs(curr.position_pct - pos) < Math.abs(prev.position_pct - pos) ? curr : prev
      )
      point[bookId] = closest.tension_score
    }
    return point
  })
}

export function Compare() {
  const [books, setBooks] = useState<Book[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [arcs, setArcs] = useState<Record<string, ArcPoint[]>>({})
  const [titles, setTitles] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [comparing, setComparing] = useState(false)
  const [chartData, setChartData] = useState<any[]>([])

  useEffect(() => {
    api.books({ limit: 48 }).then(data => {
      setBooks(data)
      const t: Record<string, string> = {}
      data.forEach(b => { t[b.book_id] = b.title })
      setTitles(t)
      setLoading(false)
      data.forEach(book => {
        api.arc(book.book_id).then(arc => {
          setArcs(prev => ({ ...prev, [book.book_id]: arc }))
        }).catch(() => {})
      })
    })
  }, [])

  const toggle = (id: string) => {
    setSelected(prev =>
      prev.includes(id)
        ? prev.filter(x => x !== id)
        : prev.length < 4 ? [...prev, id] : prev
    )
  }

  const runCompare = async () => {
    if (selected.length < 2) return
    setComparing(true)
    const data = await api.compare(selected)
    setChartData(mergeArcs(data))
    setComparing(false)
  }

  return (
    <div className="max-w-7xl mx-auto px-6 py-10 space-y-8">
      <div>
        <p className="label mb-2">Compare Mode</p>
        <h1 className="font-serif text-4xl text-text">Side by Side</h1>
        <p className="mt-2 text-subtle">Pick 2–4 books and see whose story hits harder, faster, darker.</p>
      </div>

      {/* Selected chips */}
      {selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {selected.map((id, i) => (
            <div
              key={id}
              className="flex items-center gap-2 pl-3 pr-2 py-1.5 rounded-full text-sm border"
              style={{ borderColor: COLORS[i] + "60", background: COLORS[i] + "15", color: COLORS[i] }}
            >
              <span className="max-w-[180px] truncate">{titles[id]}</span>
              <button onClick={() => toggle(id)} className="opacity-60 hover:opacity-100">
                <X size={12} />
              </button>
            </div>
          ))}
          {selected.length >= 2 && (
            <button
              onClick={runCompare}
              disabled={comparing}
              className="btn-primary ml-2"
            >
              {comparing ? "Loading…" : "Compare"}
            </button>
          )}
        </div>
      )}

      {/* Chart */}
      {chartData.length > 0 && (
        <div className="card p-5">
          <h2 className="label mb-4">How Their Stories Rise & Fall</h2>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1c1c28" vertical={false} />
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
              <Tooltip
                contentStyle={{ background: "#111118", border: "1px solid #1c1c28", borderRadius: 8, fontSize: 12 }}
                labelFormatter={v => `${(Number(v) * 100).toFixed(1)}% through`}
                formatter={(v, name) => {
                  const title = String(name)
                  const display = title.length > 35 ? title.slice(0, 35) + "…" : title
                  return [`${(Number(v) * 100).toFixed(1)}%`, display]
                }}
              />
              <Legend
                formatter={id => (
                  <span className="text-xs text-subtle">
                    {titles[id]?.slice(0, 30) ?? id}
                  </span>
                )}
                wrapperStyle={{ paddingTop: 12 }}
              />
              {selected.map((id, i) => (
                <Line
                  key={id}
                  type="monotone"
                  dataKey={id}
                  stroke={COLORS[i]}
                  strokeWidth={2}
                  dot={false}
                  name={titles[id] ?? id}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Verdict */}
      {chartData.length > 0 && (
        <Verdict selected={selected} arcs={arcs} titles={titles} />
      )}

      {/* Book picker */}
      <div>
        <p className="label mb-4">
          {selected.length === 0
            ? "Choose your books"
            : `${selected.length}/4 chosen`}
        </p>
        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="card h-40 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {books.map(book => (
              <BookCard
                key={book.book_id}
                book={book}
                arc={arcs[book.book_id] ?? []}
                selected={selected.includes(book.book_id)}
                onSelect={() => toggle(book.book_id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
