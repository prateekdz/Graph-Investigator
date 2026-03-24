import { useMemo } from 'react'

function asText(v) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number') return String(v)
  return ''
}

function parseIdFromNodeId(nodeId) {
  const s = String(nodeId || '')
  if (!s.includes(':')) return s
  return s.split(':').slice(1).join(':')
}

function pickCurrency(fields) {
  return asText(fields?.transactionCurrency) || asText(fields?.companyCodeCurrency) || asText(fields?.currency) || ''
}

function pickAmount(node) {
  const f = node?.fields || {}
  const raw = f.totalNetAmount ?? f.amountInTransactionCurrency ?? f.amountInCompanyCodeCurrency ?? f.amount ?? null
  if (raw === null || raw === undefined || raw === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n)) return null
  return { value: n, currency: pickCurrency(f) }
}

function pickDate(node) {
  const f = node?.fields || {}
  return (
    asText(f.creationDate) ||
    asText(f.billingDocumentDate) ||
    asText(f.postingDate) ||
    asText(f.documentDate) ||
    asText(f.clearingDate) ||
    ''
  )
}

function primaryId(node) {
  const f = node?.fields || {}
  if (!node) return ''
  if (node.type === 'Customer') return asText(f.businessPartner || f.customer) || parseIdFromNodeId(node.id)
  if (node.type === 'SalesOrder') return asText(f.salesOrder) || parseIdFromNodeId(node.id)
  if (node.type === 'Delivery') return asText(f.deliveryDocument) || parseIdFromNodeId(node.id)
  if (node.type === 'BillingDocument') return asText(f.billingDocument) || parseIdFromNodeId(node.id)
  if (node.type === 'Payment') return asText(f.accountingDocument) || parseIdFromNodeId(node.id)
  if (node.type === 'JournalEntry') return asText(f.accountingDocument) || parseIdFromNodeId(node.id)
  return parseIdFromNodeId(node.id)
}

function formatMoney(amount) {
  if (!amount) return '—'
  const { value, currency } = amount
  try {
    const nf = new Intl.NumberFormat(undefined, {
      style: currency ? 'currency' : 'decimal',
      currency: currency || undefined,
      maximumFractionDigits: 2,
    })
    return nf.format(value)
  } catch {
    const rounded = Math.round(value * 100) / 100
    return currency ? `${currency} ${rounded}` : String(rounded)
  }
}

function statusDot(status) {
  if (status === 'completed') return 'bg-emerald-500'
  if (status === 'error') return 'bg-rose-500'
  return 'bg-slate-300'
}

function StepIcon({ type }) {
  const common = 'h-5 w-5 text-slate-700'
  if (type === 'Customer')
    return (
      <svg className={common} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M16 21v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M9 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M22 21v-1a4 4 0 0 0-3-3.87" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    )
  if (type === 'SalesOrder')
    return (
      <svg className={common} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M7 7h14v14H7zM3 3h14v4H3zM3 7h4v14H3z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      </svg>
    )
  if (type === 'Delivery')
    return (
      <svg className={common} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M3 7h12v10H3zM15 10h4l2 3v4h-6V10Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        <path d="M7 20a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM17 20a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" fill="currentColor" />
      </svg>
    )
  if (type === 'BillingDocument')
    return (
      <svg className={common} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M7 3h10l4 4v14H7V3Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        <path d="M17 3v6h6" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        <path d="M9 13h10M9 17h7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    )
  if (type === 'Payment')
    return (
      <svg className={common} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M3 7h18v10H3V7Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        <path d="M16 12h2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M7 12h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    )
  return (
    <svg className={common} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 3h10l4 4v14H7V3Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M9 13h10M9 17h7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function Connector({ active }) {
  return (
    <div className="w-10 flex items-center justify-center">
      <div className="relative h-8 w-full">
        <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[3px] rounded-full bg-blue-100" />
        <div
          className={[
            'absolute inset-0 rounded-full bg-gradient-to-r from-blue-200 via-blue-500/60 to-blue-200 bg-[length:200%_100%]',
            active ? 'opacity-60 animate-[flow_1.4s_linear_infinite]' : 'opacity-25',
          ].join(' ')}
        />
        <div className="absolute right-0 top-1/2 -translate-y-1/2 text-blue-400 text-xs font-bold">→</div>
      </div>
    </div>
  )
}

export default function FlowTimeline({ flow, activeNodeId, onSelectNode, onClear }) {
  const steps = useMemo(
    () => [
      { key: 'customer', title: 'Customer', node: flow?.customer || null, type: 'Customer' },
      { key: 'order', title: 'Order', node: flow?.order || null, type: 'SalesOrder' },
      { key: 'delivery', title: 'Delivery', node: flow?.delivery || null, type: 'Delivery' },
      { key: 'invoice', title: 'Invoice', node: flow?.invoice || null, type: 'BillingDocument' },
      { key: 'payment', title: 'Payment', node: flow?.payment || null, type: 'Payment' },
      { key: 'journalEntry', title: 'Journal Entry', node: flow?.journalEntry || null, type: 'JournalEntry' },
    ],
    [flow],
  )

  if (!flow) return null

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-[0_12px_28px_rgba(15,23,42,0.10)]">
      <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-bold text-slate-900 tracking-tight">Business Process Flow</div>
          <div className="text-xs text-slate-500 mt-0.5">Customer → Order → Delivery → Invoice → Payment → Journal Entry</div>
        </div>
        <button
          type="button"
          className="h-9 px-3 rounded-xl border border-slate-200 bg-white text-slate-700 text-sm font-semibold hover:bg-slate-50 transition"
          onClick={onClear}
        >
          Clear
        </button>
      </div>

      <div className="p-4">
        <div className="flex items-stretch gap-3 overflow-x-auto scroll-smooth no-scrollbar pb-2">
          {steps.map((s, idx) => {
            const node = s.node
            const isActive = Boolean(node?.id && activeNodeId && node.id === activeNodeId)
            const status = node?.status || 'missing'
            const amount = pickAmount(node)
            const date = pickDate(node)
            const pid = node ? primaryId(node) : ''

            return (
              <div key={s.key} className="flex items-stretch gap-3 shrink-0">
                <button
                  type="button"
                  disabled={!node?.id}
                  onClick={() => node?.id && onSelectNode?.(node.id)}
                  className={[
                    'relative text-left min-w-[240px] max-w-[260px] rounded-2xl border bg-white px-4 py-3 shadow-sm transition',
                    node?.id ? 'border-slate-200 hover:border-blue-200 hover:shadow-md' : 'border-dashed border-slate-200',
                    isActive ? 'ring-4 ring-blue-100 border-blue-200' : '',
                    node?.id ? 'cursor-pointer' : 'cursor-default opacity-70',
                  ].join(' ')}
                >
                  <span className={`absolute left-4 top-4 h-2.5 w-2.5 rounded-full ${statusDot(status)}`} aria-label={status} title={status} />

                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 rounded-xl border border-slate-200 bg-slate-50 grid place-items-center shrink-0">
                      <StepIcon type={s.type} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-slate-900 leading-tight">{s.title}</div>
                      <div className="mt-0.5 text-xs text-slate-500 break-all">{node?.id ? `ID ${pid}` : 'Missing in flow'}</div>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-2 py-2">
                      <div className="text-[11px] text-slate-500 font-semibold">ID</div>
                      <div className="mt-0.5 text-slate-900 font-bold truncate">{pid || '—'}</div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-2 py-2">
                      <div className="text-[11px] text-slate-500 font-semibold">Amount</div>
                      <div className="mt-0.5 text-slate-900 font-bold truncate">{formatMoney(amount)}</div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-2 py-2">
                      <div className="text-[11px] text-slate-500 font-semibold">Date</div>
                      <div className="mt-0.5 text-slate-900 font-bold truncate">{date ? date.slice(0, 10) : '—'}</div>
                    </div>
                  </div>
                </button>

                {idx < steps.length - 1 ? <Connector active={Boolean(node?.id && steps[idx + 1]?.node?.id)} /> : null}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

