export default function DashboardLayout({ header, left, right }) {
  return (
    <div className="w-full h-screen bg-[#f9fafb] text-gray-900 overflow-hidden antialiased">
      <div className="h-full w-full flex flex-col">
        {header}
        <div className="flex-1 min-h-0 grid grid-cols-[1fr_300px] gap-4 px-5 py-4 overflow-hidden">
          <div className="min-h-0 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">{left}</div>
          <div className="min-h-0 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">{right}</div>
        </div>
      </div>
    </div>
  )
}
