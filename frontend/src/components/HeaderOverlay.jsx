function IconButton({ children, label }) {
  return (
    <button
      type="button"
      aria-label={label}
      className="h-8 w-8 grid place-items-center rounded-lg border border-gray-200 bg-white text-gray-900 shadow-sm hover:bg-gray-50 transition duration-200 focus:outline-none focus:ring-4 focus:ring-black/10 active:scale-[0.98]"
    >
      {children}
    </button>
  )
}

export default function HeaderOverlay() {
  return (
    <header className="h-12 bg-white border-b border-gray-200">
      <div className="h-full px-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <IconButton label="Menu">
            <svg viewBox="0 0 24 24" className="h-4.5 w-4.5 text-gray-900" fill="none" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </IconButton>

          <nav className="min-w-0 text-sm tracking-tight select-none flex items-center">
            <span className="font-semibold text-gray-900">Mapping</span>
            <span className="mx-2 text-gray-400">/</span>
            <span className="font-medium text-gray-500 truncate">Order to Cash</span>
          </nav>
        </div>
      </div>
    </header>
  )
}
