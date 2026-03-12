import { Link, useLocation } from "react-router-dom"
import { BookOpen } from "lucide-react"
import { cn } from "@/lib/utils"

const links = [
  { to: "/",        label: "Library"  },
  { to: "/compare", label: "Compare"  },
  { to: "/explore", label: "Explore"  },
]

export function Navbar() {
  const { pathname } = useLocation()

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-bg/80 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2.5 group">
          <BookOpen size={18} className="text-accent" />
          <span className="font-serif font-semibold text-text tracking-wide">Bookish</span>
        </Link>

        <nav className="flex items-center gap-1">
          {links.map(({ to, label }) => (
            <Link
              key={to}
              to={to}
              className={cn(
                "px-3 py-1.5 rounded-md text-sm transition-colors",
                pathname === to
                  ? "text-text bg-muted"
                  : "text-subtle hover:text-text hover:bg-surface"
              )}
            >
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  )
}
