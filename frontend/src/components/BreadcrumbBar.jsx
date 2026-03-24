export default function BreadcrumbBar() {
  return (
    <header className="h-14 px-4 flex items-center gap-3 bg-white/95 text-slate-900 border-b border-black/10">
      <button
        className="h-9 w-9 grid place-items-center rounded-xl border border-black/15 bg-white hover:bg-slate-50 transition"
        aria-label="Toggle sidebar"
        type="button"
      >
        ☰
      </button>
      <nav className="text-[15px] font-semibold tracking-tight">
        <span className="text-slate-500">Mapping</span>
        <span className="mx-2 text-slate-400">/</span>
        <span className="text-slate-900">Order to Cash</span>
      </nav>
    </header>
  )
}
