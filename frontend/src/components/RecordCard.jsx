import { AnimatePresence, motion } from 'framer-motion'

function pickImportant(fields) {
  const f = fields || {}
  const preferred = [
    'CompanyCode',
    'companyCode',
    'FiscalYear',
    'fiscalYear',
    'AccountingDocument',
    'accountingDocument',
    'billingDocument',
    'salesOrder',
    'deliveryDocument',
    'referenceDocument',
    'transactionCurrency',
    'amountInTransactionCurrency',
    'postingDate',
    'documentDate',
  ]

  const entries = Object.entries(f).filter(([, v]) => v !== null && v !== undefined && v !== '')
  const map = new Map(entries)
  const out = []
  for (const k of preferred) if (map.has(k)) out.push([k, map.get(k)])
  for (const [k, v] of entries) if (!preferred.includes(k)) out.push([k, v])
  return out
}

function renderValue(v) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function displayKey(k) {
  const key = String(k || '')
  const map = {
    companyCode: 'CompanyCode',
    fiscalYear: 'FiscalYear',
    accountingDocument: 'AccountingDocument',
    accountingDocumentItem: 'AccountingDocumentItem',
    referenceDocument: 'ReferenceDocument',
    glAccount: 'GLAccount',
    profitCenter: 'ProfitCenter',
    costCenter: 'CostCenter',
    transactionCurrency: 'TransactionCurrency',
    amountInTransactionCurrency: 'AmountInTransactionCurrency',
    companyCodeCurrency: 'CompanyCodeCurrency',
    amountInCompanyCodeCurrency: 'AmountInCompanyCodeCurrency',
    postingDate: 'PostingDate',
    documentDate: 'DocumentDate',
    clearingDate: 'ClearingDate',
    billingDocument: 'BillingDocument',
    salesOrder: 'SalesOrder',
    deliveryDocument: 'DeliveryDocument',
  }
  return map[key] || key
}

export default function RecordCard({ open, details, onClose }) {
  const node = details?.node || null
  const neighbors = details?.neighbors || []
  const fields = node?.fields || {}
  const entries = pickImportant(fields)
  const hasMore = node?.hasMoreFields

  return (
    <AnimatePresence>
      {open && node ? (
        <motion.div
          initial={{ opacity: 0, y: 14, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 14, scale: 0.98 }}
          transition={{ duration: 0.18 }}
          className="absolute left-1/2 top-16 -translate-x-1/2 w-[320px] max-h-[75vh] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_12px_28px_rgba(15,23,42,0.10)] text-slate-900 z-20"
        >
          <div className="px-4 py-3 border-b border-slate-200 flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-bold tracking-tight">{node.type}</div>
              <div className="text-xs text-slate-500 break-all">{node.id}</div>
            </div>
            <button
              type="button"
              className="h-8 w-8 grid place-items-center rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition"
              onClick={onClose}
              aria-label="Close"
            >
              ×
            </button>
          </div>

          <div className="p-4 overflow-auto max-h-[calc(75vh-112px)]">
            <div className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-2 text-xs">
              <div className="contents">
                <div className="text-slate-500 font-semibold">Entity</div>
                <div className="text-slate-900 break-words">{node.type}</div>
              </div>
              {entries.slice(0, 18).map(([k, v]) => (
                <div key={k} className="contents">
                  <div className="text-slate-500 font-semibold">{displayKey(k)}</div>
                  <div className="text-slate-900 break-words">{renderValue(v)}</div>
                </div>
              ))}
            </div>
            {hasMore ? <div className="mt-3 text-xs italic text-slate-500">Additional fields hidden for readability</div> : null}

            <div className="mt-4 pt-4 border-t border-slate-200 text-xs flex items-center justify-between">
              <div className="text-slate-500 font-semibold">Connections</div>
              <div className="text-slate-900 font-bold">{node.connections ?? neighbors.length}</div>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

