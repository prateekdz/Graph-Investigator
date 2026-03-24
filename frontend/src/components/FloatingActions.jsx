export default function FloatingActions({ minimized, onToggleMinimize, overlayHidden, onToggleOverlay }) {
  return (
    <div className="absolute top-4 left-4 flex gap-3 z-10" aria-label="Graph actions">
      <button
        type="button"
        className="rounded-md px-3 py-1.5 border border-gray-200 bg-white text-gray-900 text-[13px] font-semibold shadow-sm hover:bg-gray-50 transition duration-200 inline-flex items-center gap-2 focus:outline-none focus:ring-4 focus:ring-black/10 active:scale-[0.98]"
        onClick={onToggleMinimize}
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4 text-gray-700" fill="none" aria-hidden="true">
          <path
            d="M8 8h5M8 8v5M16 16h-5M16 16v-5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
        {minimized ? 'Restore' : 'Minimize'}
      </button>
      <button
        type="button"
        className="bg-black text-white hover:bg-gray-900 rounded-md px-3 py-1.5 transition duration-200 inline-flex items-center gap-2 text-[13px] font-semibold shadow-sm focus:outline-none focus:ring-4 focus:ring-black/10 active:scale-[0.98]"
        onClick={onToggleOverlay}
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4 text-white" fill="none" aria-hidden="true">
          <path
            d="M7 8h10M7 12h10M7 16h10"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
        {overlayHidden ? 'Show Granular Overlay' : 'Hide Granular Overlay'}
      </button>
    </div>
  )
}
