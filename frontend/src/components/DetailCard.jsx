import { AnimatePresence, motion } from 'framer-motion'

function pickImportant(fields) {
  const f = fields || {}
  const preferred = [
    'entityType',
    'entityId',
    'companyCode',
    'fiscalYear',
    'accountingDocument',
    'accountingDocumentItem',
    'glAccount',
    'referenceDocument',
    'referenceBillingDocument',
    'transactionCurrency',
    'companyCodeCurrency',
    'amountInTransactionCurrency',
    'amountInCompanyCodeCurrency',
    'postingDate',
    'documentDate',
    'clearingDate',
    'salesOrder',
    'deliveryDocument',
    'billingDocument',
    'customer',
  ]

  const entries = Object.entries(f).filter(([, v]) => v !== null && v !== undefined && v !== '')
  const map = new Map(entries)
  const out = []
  for (const k of preferred) if (map.has(k)) out.push([k, map.get(k)])
  for (const [k, v] of entries) if (!preferred.includes(k)) out.push([k, v])
  return out
}

function displayKey(k) {
  const key = String(k || '')
  const map = {
    entityType: 'Entity',
    entityId: 'EntityId',
    companyCode: 'CompanyCode',
    fiscalYear: 'FiscalYear',
    accountingDocument: 'AccountingDocument',
    accountingDocumentItem: 'AccountingDocumentItem',
    glAccount: 'GLAccount',
    referenceDocument: 'ReferenceDocument',
    referenceBillingDocument: 'ReferenceDocument',
    transactionCurrency: 'TransactionCurrency',
    companyCodeCurrency: 'CompanyCodeCurrency',
    amountInTransactionCurrency: 'AmountInTransactionCurrency',
    amountInCompanyCodeCurrency: 'AmountInCompanyCodeCurrency',
    postingDate: 'PostingDate',
    documentDate: 'DocumentDate',
    clearingDate: 'ClearingDate',
  }
  return map[key] || key
}

function renderValue(v) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function prettyTitle(type) {
  const t = String(type || '')
  if (t === 'JournalEntry' || t === 'JournalEntryItem') return 'Journal Entry'
  return t
}

export default function DetailCard({ details, onClose }) {
  const node = details?.node || null
  const neighbors = details?.neighbors || []
  const fields = node?.fields || {}
  const entries = pickImportant(fields)
  const hasMore = node?.hasMoreFields

  return (
    <AnimatePresence>
      {node ? (
        <motion.div
          initial={{ opacity: 0, y: 10, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.98 }}
          transition={{ duration: 0.16 }}
          className="w-[320px] rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden"
        >
          <div className="px-4 py-2 border-b border-gray-200 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-base font-semibold text-gray-900 tracking-tight">{prettyTitle(node.type)}</div>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-rose-400 ring-1 ring-black/10" />
              <span className="h-2.5 w-2.5 rounded-full bg-amber-300 ring-1 ring-black/10" />
              <span className="h-2.5 w-2.5 rounded-full bg-gray-200 ring-1 ring-black/10" />
            </button>
          </div>

          <div className="p-4">
            <div className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-2 text-[12px]">
              <div className="text-gray-500 font-semibold">Entity</div>
              <div className="text-gray-900 break-all">{String(node.type || '')}</div>
              {entries.slice(0, 16).map(([k, v]) => (
                <div key={k} className="contents">
                  <div className="text-gray-500 font-semibold">{displayKey(k)}</div>
                  <div className="text-gray-900 break-all">{renderValue(v)}</div>
                </div>
              ))}
            </div>

            {hasMore ? (
              <div className="mt-3 text-xs italic text-gray-400">Additional fields hidden for readability</div>
            ) : null}

            <div className="mt-3 pt-3 border-t border-gray-200 text-[12px] text-gray-700">
              <span className="font-semibold">Connections:</span>{' '}
              <span className="font-bold text-gray-900">{node.connections ?? neighbors.length}</span>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
