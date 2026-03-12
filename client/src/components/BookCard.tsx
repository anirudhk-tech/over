import { Link } from "react-router-dom"
import type { Book, ArcPoint } from "@/api"
import { Sparkline } from "./Sparkline"
import { cn } from "@/lib/utils"

interface Props {
  book: Book
  arc?: ArcPoint[]
  selected?: boolean
  onSelect?: () => void
}

export function BookCard({ book, arc = [], selected, onSelect }: Props) {
  const maxTension = arc.length ? Math.max(...arc.map(d => d.tension_score)) : null
  const genre = book.subjects?.[0] ?? null

  return (
    <div
      className={cn(
        "card p-5 flex flex-col gap-4 cursor-pointer transition-all duration-200",
        "hover:border-subtle hover:bg-surface/80",
        selected && "border-accent ring-1 ring-accent/30"
      )}
      onClick={onSelect}
    >
      {/* Genre tag */}
      {genre && (
        <span className="label w-fit">{genre.length > 30 ? genre.slice(0, 30) + "…" : genre}</span>
      )}

      {/* Title & author */}
      <div className="flex-1">
        <Link
          to={`/book/${book.book_id}`}
          className="font-serif text-lg leading-snug text-text hover:text-accent transition-colors line-clamp-2"
          onClick={e => e.stopPropagation()}
        >
          {book.title}
        </Link>
        {book.author && (
          <p className="mt-1 text-sm text-subtle">{book.author}</p>
        )}
      </div>

      {/* Sparkline */}
      <div className="flex items-end justify-between gap-3">
        <Sparkline data={arc} width={100} height={28} />
        {maxTension !== null && (
          <div className="text-right">
            <div className="text-xs text-subtle">climax</div>
            <div
              className="text-sm font-medium"
              style={{ color: `hsl(${(1 - maxTension) * 120}, 70%, 55%)` }}
            >
              {(maxTension * 100).toFixed(0)}%
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
