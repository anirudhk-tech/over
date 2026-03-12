import { useEffect, useState } from "react"
import { Search } from "lucide-react"
import { api } from "@/api"
import type { Book, ArcPoint } from "@/api"
import { BookCard } from "@/components/BookCard"

export function Library() {
  const [books, setBooks] = useState<Book[]>([])
  const [arcs, setArcs] = useState<Record<string, ArcPoint[]>>({})
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.books({ limit: 48 })
      .then(data => {
        setBooks(data)
        setLoading(false)
        // Load arcs in background for sparklines
        data.forEach(book => {
          api.arc(book.book_id).then(arc => {
            setArcs(prev => ({ ...prev, [book.book_id]: arc }))
          }).catch(() => {})
        })
      })
      .catch(() => setLoading(false))
  }, [])

  const filtered = books.filter(b =>
    b.title.toLowerCase().includes(search.toLowerCase()) ||
    b.author?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="max-w-7xl mx-auto px-6 py-10">
      {/* Header */}
      <div className="mb-10">
        <p className="label mb-2">Library · {books.length} books analyzed</p>
        <h1 className="font-serif text-4xl text-text">The Shape of Every Story</h1>
        <p className="mt-2 text-subtle max-w-lg">
          Watch how a book's curve looks like before you commit.
        </p>
      </div>

      {/* Search */}
      <div className="relative mb-8 max-w-sm">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
        <input
          type="text"
          placeholder="Search by title or author…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full bg-surface border border-border rounded-md pl-9 pr-4 py-2 text-sm text-text placeholder:text-subtle focus:outline-none focus:border-subtle transition-colors"
        />
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="card h-44 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-24 text-subtle">No books found.</div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filtered.map(book => (
            <BookCard
              key={book.book_id}
              book={book}
              arc={arcs[book.book_id] ?? []}
            />
          ))}
        </div>
      )}
    </div>
  )
}
