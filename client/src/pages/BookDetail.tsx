import { useEffect, useState } from "react"
import { useParams, Link } from "react-router-dom"
import { ArrowLeft, User, Hash } from "lucide-react"
import { api } from "@/api"
import type { Book, ArcPoint, Character } from "@/api"
import { ArcChart } from "@/components/ArcChart"

function StatBadge({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="card px-4 py-3">
      <div className="label mb-1">{label}</div>
      <div className="text-xl font-medium" style={{ color: color ?? "#e8e6e3" }}>{value}</div>
    </div>
  )
}

function CharacterTimeline({ characters }: { characters: Character[] }) {
  if (!characters.length) return null
  const top = characters.slice(0, 8)

  return (
    <div className="card p-5">
      <h3 className="label mb-4">Who's On Stage</h3>
      <div className="space-y-3">
        {top.map(c => (
          <div key={c.character_name} className="flex items-center gap-3">
            <div className="w-24 text-xs text-subtle truncate shrink-0">{c.character_name}</div>
            <div className="flex-1 relative h-4 bg-muted rounded-full overflow-hidden">
              <div
                className="absolute h-full rounded-full bg-accent/40 border border-accent/60"
                style={{
                  left: `${c.first_appearance_pct * 100}%`,
                  width: `${(c.last_appearance_pct - c.first_appearance_pct) * 100}%`,
                }}
              />
              <div
                className="absolute h-full w-1 rounded-full bg-accent"
                style={{ left: `${c.peak_presence_pct * 100}%` }}
              />
            </div>
            <div className="text-xs text-subtle w-10 text-right shrink-0">
              {c.mention_count}×
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-4 text-xs text-subtle">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-1.5 rounded bg-accent/40 border border-accent/60" />
          on stage
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-1 h-3 rounded bg-accent" />
          most prominent
        </div>
      </div>
    </div>
  )
}

export function BookDetail() {
  const { id } = useParams<{ id: string }>()
  const [book, setBook] = useState<Book | null>(null)
  const [arc, setArc] = useState<ArcPoint[]>([])
  const [characters, setCharacters] = useState<Character[]>([])
  const [showSentiment, setShowSentiment] = useState(true)
  const [showPacing, setShowPacing] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    Promise.all([api.book(id), api.arc(id), api.characters(id)])
      .then(([book, arc, chars]) => {
        setBook(book)
        setArc(arc)
        setCharacters(chars)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [id])

  if (loading) return (
    <div className="max-w-5xl mx-auto px-6 py-10 space-y-4">
      <div className="h-8 w-48 bg-surface rounded animate-pulse" />
      <div className="h-12 w-96 bg-surface rounded animate-pulse" />
      <div className="h-72 bg-surface rounded-lg animate-pulse mt-8" />
    </div>
  )

  if (!book) return (
    <div className="max-w-5xl mx-auto px-6 py-24 text-center text-subtle">Book not found.</div>
  )

  const avgTension = arc.length
    ? arc.reduce((s, d) => s + d.tension_score, 0) / arc.length
    : 0
  const peakTension = arc.length ? Math.max(...arc.map(d => d.tension_score)) : 0
  const peakChunk = arc.find(d => d.tension_score === peakTension)

  return (
    <div className="max-w-5xl mx-auto px-6 py-10 space-y-8">
      {/* Back */}
      <Link to="/" className="btn-ghost w-fit -ml-2 text-sm">
        <ArrowLeft size={14} />
        Library
      </Link>

      {/* Hero */}
      <div className="flex flex-col gap-2">
        {book.subjects?.[0] && <span className="label">{book.subjects[0]}</span>}
        <h1 className="font-serif text-4xl md:text-5xl text-text leading-tight">{book.title}</h1>
        {book.author && (
          <div className="flex items-center gap-1.5 text-subtle">
            <User size={13} />
            <span>{book.author}</span>
          </div>
        )}
        {book.publish_year && (
          <div className="flex items-center gap-1.5 text-subtle text-sm">
            <Hash size={13} />
            <span>{book.publish_year}</span>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatBadge
          label="Overall Intensity"
          value={`${(avgTension * 100).toFixed(0)}%`}
          color={`hsl(${(1 - avgTension) * 120}, 70%, 55%)`}
        />
        <StatBadge
          label="Climax"
          value={`${(peakTension * 100).toFixed(0)}%`}
          color="#f59e0b"
        />
        <StatBadge
          label="Peaks At"
          value={peakChunk ? `${(peakChunk.position_pct * 100).toFixed(0)}% in` : "—"}
        />
        <StatBadge
          label="Chapters"
          value={`${arc.filter(d => d.chapter).length || arc.length}`}
        />
      </div>

      {/* Arc chart */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h2 className="label">Story Arc</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSentiment(v => !v)}
              className={`px-2.5 py-1 rounded text-xs transition-colors ${showSentiment ? "bg-green-500/20 text-green-400 border border-green-500/30" : "text-subtle hover:text-text"}`}
            >
              Mood
            </button>
            <button
              onClick={() => setShowPacing(v => !v)}
              className={`px-2.5 py-1 rounded text-xs transition-colors ${showPacing ? "bg-calm/20 text-calm border border-calm/30" : "text-subtle hover:text-text"}`}
            >
              Pace
            </button>
          </div>
        </div>
        <ArcChart data={arc} showSentiment={showSentiment} showPacing={showPacing} />
      </div>

      {/* Characters */}
      <CharacterTimeline characters={characters} />

      {/* Subjects */}
      {book.subjects?.length > 0 && (
        <div className="card p-5">
          <h3 className="label mb-3">Themes</h3>
          <div className="flex flex-wrap gap-2">
            {book.subjects.map(s => (
              <span key={s} className="px-2.5 py-1 bg-muted rounded-md text-xs text-subtle">
                {s}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
