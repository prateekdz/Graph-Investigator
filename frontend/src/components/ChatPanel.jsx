import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useMemo, useRef, useState } from 'react'
import RichText from './RichText'

function nowTime() {
  const d = new Date()
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function Avatar({ kind }) {
  if (kind === 'ai')
    return (
      <div className="h-9 w-9 rounded-full bg-black text-white grid place-items-center shrink-0">
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
          <path d="M8 8h8v8H8V8Zm-2-2h12v12H6V6Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        </svg>
      </div>
    )
  return <div className="h-9 w-9 rounded-full bg-gray-200 border border-gray-200 shrink-0" />
}

function StructuredText({ text }) {
  const lines = String(text || '').split('\n')
  return (
    <div className="text-sm text-gray-700 leading-relaxed">
      {lines.map((raw, idx) => {
        const line = raw.replace(/\r/g, '')
        if (!line.trim()) return <div key={idx} className="h-2" />

        const isBullet = line.trimStart().startsWith('- ')
        if (isBullet) {
          const content = line.trimStart().slice(2)
          return (
            <div key={idx} className="flex gap-2">
              <span className="mt-2 h-1.5 w-1.5 rounded-full bg-gray-300 shrink-0" />
              <div className="min-w-0">
                <RichText text={content} className="whitespace-pre-wrap break-words" />
              </div>
            </div>
          )
        }

        return (
          <div key={idx}>
            <RichText text={line} className="whitespace-pre-wrap break-words" />
          </div>
        )
      })}
    </div>
  )
}

function toEvidenceFromNode(node, neighbors) {
  if (!node) return null
  const fields = node.fields || {}
  const id = fields.entityId || node.entityId || String(node.id || '').split(':').slice(1).join(':')
  const companyCode = fields.companyCode || fields.CompanyCode || null
  const fiscalYear = fields.fiscalYear || fields.FiscalYear || null
  const date = fields.postingDate || fields.documentDate || fields.creationDate || fields.billingDocumentDate || null
  const amount =
    fields.totalNetAmount ??
    fields.amountInTransactionCurrency ??
    fields.amountInCompanyCodeCurrency ??
    fields.amount ??
    null
  const currency = fields.transactionCurrency || fields.companyCodeCurrency || fields.currency || null
  const connections = Array.isArray(neighbors) ? neighbors.length : node.connections ?? 0

  const bullets = [`- **ID:** ${id}`]
  if (companyCode) bullets.push(`- **Company Code:** ${companyCode}`)
  if (fiscalYear) bullets.push(`- **Fiscal Year:** ${fiscalYear}`)
  if (amount !== null && amount !== undefined && amount !== '')
    bullets.push(`- **Amount:** ${currency ? `${currency} ` : ''}${amount}`)
  if (date) bullets.push(`- **Date:** ${String(date).slice(0, 10)}`)
  bullets.push(`- **Connections:** ${connections}`)

  return {
    text: `Here's the context for what you selected:\n\n**${node.type}**\n${bullets.join('\n')}\n\nTip: click any connected node to keep tracing.`,
    actions: [
      { label: 'Trace full flow', query: `Trace ${node.type} ${id}` },
      { label: 'Show neighbors', query: `Show connected records for ${node.type} ${id}` },
    ],
    blocks: [
      {
        kind: 'record',
        node: { id: node.id, type: node.type, label: node.label || null },
        evidence: bullets
          .map((b) => {
            const m = String(b).replace(/^\-\s*/, '')
            const idx = m.indexOf(':')
            if (idx === -1) return null
            return { label: m.slice(0, idx).replace(/\*\*/g, ''), value: m.slice(idx + 1).trim().replace(/\*\*/g, '') }
          })
          .filter(Boolean),
        connections: [],
        totals: { connections },
      },
    ],
  }
}

function EvidenceCard({ block, onPickNodeId }) {
  if (!block || block.kind !== 'record') return null
  const title = block?.node?.type || 'Record'
  const label = block?.node?.label || block?.node?.id || ''
  const evidence = Array.isArray(block?.evidence) ? block.evidence : []
  const conn = Array.isArray(block?.connections) ? block.connections : []
  const totalConn = block?.totals?.connections ?? null

  return (
    <div className="mt-3 rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden transition duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <div className="px-3 py-2 border-b border-gray-200 bg-gray-50 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-gray-900 truncate">{title}</div>
          <div className="text-[11px] text-gray-500 truncate">{label}</div>
        </div>
        <button
          type="button"
          onClick={() => onPickNodeId?.(block?.node?.id)}
          className="bg-black text-white hover:bg-gray-900 rounded-md px-3 py-1.5 transition duration-200 text-xs font-semibold shadow-sm focus:outline-none focus:ring-4 focus:ring-black/10 active:scale-[0.98]"
        >
          Open
        </button>
      </div>

      <div className="p-3">
        <div className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-2 text-xs">
          {evidence.slice(0, 10).map((e) => (
            <div key={e.label} className="contents">
              <div className="text-gray-500 font-semibold">{e.label}</div>
              <div className="text-gray-900 break-words">{e.value}</div>
            </div>
          ))}
        </div>

        {totalConn !== null ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-gray-500 font-semibold">Connections</span>
            <span className="text-[11px] font-bold text-gray-900">{totalConn}</span>
            {conn.slice(0, 5).map((c) => (
              <span key={c.type} className="text-[11px] px-2 py-1 rounded-full border border-gray-200 bg-white text-gray-700">
                {c.type} · {c.count}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function QueryCard({ block }) {
  if (!block || block.kind !== 'query') return null
  const language = String(block.language || 'cypher').toUpperCase()
  const query = String(block.query || '').trim()
  if (!query) return null

  return (
    <details className="mt-3 rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <summary className="cursor-pointer select-none px-3 py-2 border-b border-gray-200 bg-gray-50 text-xs font-semibold text-gray-700 flex items-center justify-between">
        <span>Executed {language} query</span>
        <span className="text-[11px] font-semibold text-gray-500">Click to expand</span>
      </summary>
      <pre className="m-0 p-3 text-[12px] leading-relaxed text-gray-900 overflow-auto whitespace-pre-wrap">
        {query}
      </pre>
    </details>
  )
}

export default function ChatPanel({ onSearch: _onSearch, onChat, insight, onPickNodeId }) {
  const [messages, setMessages] = useState(() => [
    {
      id: crypto.randomUUID(),
      role: 'ai',
      time: nowTime(),
      text: 'Ask about any document ID, or trace an entity end-to-end.',
      actions: [
        { label: 'Find invoice', query: 'Find invoice <id>' },
        { label: 'Trace order', query: 'Trace order <id>' },
      ],
      blocks: [],
    },
  ])
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(false)
  const endRef = useRef(null)
  const messagesRef = useRef([])
  const lastInsightKey = useRef(null)

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, pending])

  const canSend = useMemo(() => input.trim().length > 0 && !pending, [input, pending])

  useEffect(() => {
    if (!insight?.key || insight.key === lastInsightKey.current) return
    lastInsightKey.current = insight.key
    const built = toEvidenceFromNode(insight.node, insight.neighbors)
    if (!built) return
    setMessages((m) => [
      ...m,
      { id: crypto.randomUUID(), role: 'ai', time: nowTime(), text: built.text, actions: built.actions, blocks: built.blocks },
    ])
  }, [insight])

  async function sendText(text) {
    const t = String(text || '').trim()
    if (!t) return
    setPending(true)

    const nextUser = { id: crypto.randomUUID(), role: 'you', time: nowTime(), text: t, actions: [], blocks: [] }
    setMessages((m) => [...m, nextUser])

    try {
      const payloadMsgs = [...(messagesRef.current || []), nextUser].map((m) => ({
        role: m.role === 'you' ? 'user' : 'assistant',
        content: m.text,
      }))
      const res = await onChat?.(payloadMsgs)
      const reply = res?.response || 'No response.'
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: 'ai',
          time: nowTime(),
          text: reply,
          actions: Array.isArray(res?.suggestions) ? res.suggestions : [],
          blocks: Array.isArray(res?.blocks) ? res.blocks : [],
        },
      ])
    } catch (e) {
      setMessages((m) => [...m, { id: crypto.randomUUID(), role: 'ai', time: nowTime(), text: `Error: ${e?.message || String(e)}` }])
    } finally {
      setPending(false)
    }
  }

  async function send() {
    const text = input.trim()
    if (!text) return
    setInput('')
    await sendText(text)
  }

  return (
    <aside className="h-full w-full bg-white overflow-hidden flex flex-col">
      <div className="px-4 py-3 border-b border-gray-200 bg-white">
        <div className="text-base font-semibold text-gray-900">Chat with Graph</div>
        <div className="mt-1 text-sm text-gray-600">Order to Cash</div>
      </div>

      <div className="flex-1 overflow-auto px-4 py-4 space-y-6">
        <AnimatePresence initial={false}>
          {messages.map((m) =>
            m.role === 'ai' ? (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.16 }}
                className="flex gap-3 items-start"
              >
                <Avatar kind="ai" />
                <div className="flex-1 min-w-0">
                  <div className="rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-800 leading-relaxed">
                    <StructuredText text={m.text} />
                  </div>

                  {Array.isArray(m.blocks) && m.blocks.length ? (
                    <div>
                      {m.blocks
                        .slice(0, 4)
                        .map((b, i) =>
                          b?.kind === 'query' ? (
                            <QueryCard key={`q-${i}`} block={b} />
                          ) : (
                            <EvidenceCard key={`e-${i}`} block={b} onPickNodeId={onPickNodeId} />
                          ),
                        )}
                    </div>
                  ) : null}

                  {Array.isArray(m.actions) && m.actions.length ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {m.actions.slice(0, 4).map((a) => (
                        <button
                          key={a.label}
                          type="button"
                          onClick={() => sendText(a.query)}
                          className="h-7 px-3 rounded-full border border-gray-200 bg-white text-gray-700 text-[11px] font-semibold hover:bg-gray-50 transition duration-200 hover:scale-105 active:scale-[0.98]"
                        >
                          {a.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </motion.div>
            ) : (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.16 }}
                className="flex justify-end gap-3 items-start"
              >
                <div className="text-right">
                  <div className="inline-block max-w-[260px] rounded-lg bg-black text-white px-3 py-2 text-sm leading-relaxed shadow-sm">
                    {m.text}
                  </div>
                </div>
                <Avatar kind="you" />
              </motion.div>
            ),
          )}

          {pending ? (
            <motion.div
              key="typing"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.16 }}
              className="flex gap-3 items-start"
            >
              <Avatar kind="ai" />
              <div className="flex-1 min-w-0">
                <div className="inline-flex items-center gap-1.5 rounded-2xl border border-gray-200 bg-white px-3 py-2 shadow-sm">
                  <span className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-pulse" />
                  <span className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-pulse [animation-delay:120ms]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-pulse [animation-delay:240ms]" />
                </div>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <div ref={endRef} />
      </div>

      <div className="border-t border-gray-200 p-3 bg-white">
        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="flex items-center justify-between gap-2 text-xs text-gray-600 border-b border-gray-200 bg-gray-50 px-3 py-2">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full bg-emerald-500 ${pending ? 'animate-pulse' : ''}`} />
              <span>{pending ? 'Dodge AI is thinking…' : 'Dodge AI is awaiting instructions'}</span>
            </div>
            <div className="text-[11px] text-gray-500 font-semibold">Enter ↵</div>
          </div>

          <div className="p-3">
            <textarea
              className="w-full resize-none rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:ring-4 focus:ring-black/10"
              placeholder="Analyze anything"
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  if (canSend) send()
                }
              }}
            />

            <div className="mt-2 flex flex-wrap gap-2">
              {[
                { label: 'Find invoice', q: 'Find invoice <id>' },
                { label: 'Trace order', q: 'Trace order <id>' },
                { label: 'Show journal entry', q: 'Show journal entry for <id>' },
              ].map((s) => (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => setInput(s.q)}
                  className="h-7 px-3 rounded-full border border-gray-200 bg-white text-gray-600 text-[11px] font-semibold hover:bg-gray-50 transition duration-200 hover:scale-105 active:scale-[0.98]"
                >
                  {s.label}
                </button>
              ))}
            </div>

            <div className="flex justify-end mt-3">
              <button
                type="button"
                disabled={!canSend}
                onClick={send}
                className="bg-black text-white hover:bg-gray-900 rounded-md px-3 py-1.5 transition duration-200 text-sm font-semibold disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed shadow-sm focus:outline-none focus:ring-4 focus:ring-black/10 active:scale-[0.98]"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      </div>
    </aside>
  )
}
