function splitBold(text) {
  const s = String(text || '')
  const parts = []
  let i = 0
  while (i < s.length) {
    const start = s.indexOf('**', i)
    if (start === -1) {
      parts.push({ t: s.slice(i), b: false })
      break
    }
    const end = s.indexOf('**', start + 2)
    if (end === -1) {
      parts.push({ t: s.slice(i), b: false })
      break
    }
    if (start > i) parts.push({ t: s.slice(i, start), b: false })
    parts.push({ t: s.slice(start + 2, end), b: true })
    i = end + 2
  }
  return parts.filter((p) => p.t.length > 0)
}

export default function RichText({ text, className }) {
  const parts = splitBold(text)
  return (
    <span className={className}>
      {parts.map((p, idx) =>
        p.b ? (
          <strong key={idx} className="font-semibold text-slate-900">
            {p.t}
          </strong>
        ) : (
          <span key={idx}>{p.t}</span>
        ),
      )}
    </span>
  )
}
