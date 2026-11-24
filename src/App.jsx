/**
 * App.jsx
 *
 * Top-level component. Manages state for rules, cart items, and results.
 * Wires together CSV upload / PDF upload / NL rule parsing → engine → display.
 */

import { useState, useRef } from 'react'
import CsvUploader from './components/CsvUploader.jsx'
import DataTable from './components/DataTable.jsx'
import ErrorBanner from './components/ErrorBanner.jsx'
import { parseRulesCSV, parseCartCSV } from './engine/csvParser.js'
import { processCart, cartTotal, evaluateCartOffer } from './engine/discountEngine.js'
import { parseNaturalLanguageRule } from './adapters/nlRuleAdapter.js'
import { parseCartPDF } from './adapters/pdfCartAdapter.js'

// ── Column definitions ───────────────────────────────────────────

const RULES_COLUMNS = [
  { key: 'ruleId',    label: 'Rule ID' },
  { key: 'scope',     label: 'Scope',      render: (v) => v ? v.charAt(0).toUpperCase() + v.slice(1) : '—' },
  { key: 'appliesTo', label: 'Applies To' },
  { key: 'type',      label: 'Type',       render: (v) => v ? v.charAt(0).toUpperCase() + v.slice(1) : '—' },
  {
    key: 'value',
    label: 'Value',
    render: (v, row) => row.type === 'percentage' ? `${v}% off` : `Rs.${v} off`,
  },
  {
    key: 'minCartValue',
    label: 'Condition',
    render: (v, row) =>
      row.scope === 'cart' && v
        ? `Cart >= Rs.${Number(v).toLocaleString('en-IN')}`
        : '—',
  },
  { key: 'stackable', label: 'Stackable',  render: (v) => (v ? 'Yes' : 'No') },
]

const CART_COLUMNS = [
  { key: 'itemId',    label: 'Item' },
  { key: 'product',   label: 'Product' },
  { key: 'brand',     label: 'Brand' },
  { key: 'platform',  label: 'Platform' },
  { key: 'basePrice', label: 'Base Price', render: (v) => `Rs.${v.toLocaleString('en-IN')}` },
]

const RESULTS_COLUMNS = [
  { key: 'itemId',    label: 'Item' },
  { key: 'product',   label: 'Product' },
  { key: 'basePrice', label: 'Base Price',  render: (v) => `Rs.${v.toLocaleString('en-IN')}` },
  { key: 'finalPrice',label: 'Final Price',
    render: (v, row) => (
      <span style={{ fontWeight: 700, color: row.totalDiscount > 0 ? '#1e5c2c' : '#131A48' }}>
        Rs.${v.toLocaleString('en-IN')}
      </span>
    ),
  },
  {
    key: 'totalDiscount',
    label: 'You Save',
    render: (v) =>
      v > 0 ? (
        <span style={{ color: '#1e5c2c', fontWeight: 600 }}>Rs.${v.toLocaleString('en-IN')}</span>
      ) : (
        <span style={{ color: '#888' }}>—</span>
      ),
  },
  {
    key: 'reasoning',
    label: 'Offer Applied',
    render: (v) => (
      <span style={{ color: v === 'No offers available' ? '#888' : '#131A48', fontStyle: v === 'No offers available' ? 'italic' : 'normal' }}>
        {v}
      </span>
    ),
  },
]

// ── Styles ───────────────────────────────────────────────────────

const S = {
  page:    { minHeight: '100vh', background: '#f7f7f9', fontFamily: 'Arial, sans-serif' },
  header:  { background: '#131A48', padding: '0.85rem 2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  logoTxt: { fontFamily: 'Georgia, serif', fontSize: 17, fontWeight: 700, color: '#fff', letterSpacing: '-0.02em' },
  logoSpan:{ color: '#FF5800' },
  headerSub: { fontSize: 11, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.07em' },
  main:    { maxWidth: 960, margin: '0 auto', padding: '1.8rem 1.5rem' },
  section: { background: '#fff', border: '1px solid #CECECE', borderRadius: 6, padding: '1.2rem 1.4rem', marginBottom: '1.2rem' },
  sectionTitle: { fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 14, color: '#131A48', marginBottom: '0.7rem', paddingBottom: 6, borderBottom: '2px solid #FF5800', display: 'inline-block' },
  grid2:   { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', alignItems: 'start' },
  btn:     {
    background: '#FF5800', color: '#fff', border: 'none', borderRadius: 4,
    padding: '0.65rem 2rem', fontSize: 13, fontWeight: 700, cursor: 'pointer',
    letterSpacing: '0.04em', textTransform: 'uppercase',
  },
  btnDisabled: {
    background: '#CECECE', color: '#fff', border: 'none', borderRadius: 4,
    padding: '0.65rem 2rem', fontSize: 13, fontWeight: 700, cursor: 'not-allowed',
    letterSpacing: '0.04em', textTransform: 'uppercase',
  },
  btnSmall: {
    background: '#FF5800', color: '#fff', border: 'none', borderRadius: 4,
    padding: '0.5rem 1rem', fontSize: 12, fontWeight: 700, cursor: 'pointer',
    letterSpacing: '0.03em', whiteSpace: 'nowrap',
  },
  btnDisabledSmall: {
    background: '#CECECE', color: '#fff', border: 'none', borderRadius: 4,
    padding: '0.5rem 1rem', fontSize: 12, fontWeight: 700, cursor: 'not-allowed',
    letterSpacing: '0.03em', whiteSpace: 'nowrap',
  },
  totalRow: {
    display: 'flex', justifyContent: 'flex-end', alignItems: 'center',
    gap: '1rem', marginTop: '0.75rem', paddingTop: '0.75rem',
    borderTop: '2px solid #131A48',
  },
  totalLabel: { fontWeight: 700, fontSize: 14, color: '#131A48' },
  totalValue: { fontWeight: 700, fontSize: 16, color: '#131A48' },
}

// ── Component ────────────────────────────────────────────────────

export default function App() {
  const [rules, setRules]                 = useState([])
  const [rulesErrors, setRulesErr]        = useState([])
  const [rulesFileName, setRulesFileName] = useState('')

  // Natural Language Rule input state
  const [nlInput, setNlInput]             = useState('')
  const [nlLoading, setNlLoading]         = useState(false)
  const [nlErrors, setNlErrors]           = useState([])
  const [pendingRule, setPendingRule]     = useState(null)

  // Cart state
  const [cartItems, setCartItems]         = useState([])
  const [cartErrors, setCartErrors]       = useState([])
  const [cartFileName, setCartFileName]   = useState('')
  const [pdfLoading, setPdfLoading]       = useState(false)
  const pdfInputRef                       = useRef(null)

  // Results & cart offer state
  const [results, setResults]             = useState(null)
  const [cartOffer, setCartOffer]         = useState(null)

  // ── Helpers ──

  function runCalculation(items, activeRules) {
    if (items.length > 0 && activeRules.length > 0) {
      const res = processCart(items, activeRules)
      setResults(res)
      const offer = evaluateCartOffer(res, activeRules)
      setCartOffer(offer)
    } else {
      setResults(null)
      setCartOffer(null)
    }
  }

  // ── Handlers ──

  function handleRulesLoad(csvText, fileName) {
    const { data, errors } = parseRulesCSV(csvText)
    setRules(data)
    setRulesErr(errors)
    setRulesFileName(fileName)
    setResults(null)
    setCartOffer(null)
  }

  function handleCartLoad(csvText, fileName) {
    const { data, errors } = parseCartCSV(csvText)
    setCartItems(data)
    setCartErrors(errors)
    setCartFileName(fileName)
    setResults(null)
    setCartOffer(null)
  }

  function handleCalculate() {
    runCalculation(cartItems, rules)
  }

  async function handleParseNLRule(e) {
    e?.preventDefault()
    if (!nlInput.trim()) return

    setNlLoading(true)
    setNlErrors([])
    setPendingRule(null)

    const res = await parseNaturalLanguageRule(nlInput)
    setNlLoading(false)

    if (!res.ok) {
      setNlErrors([res.error])
    } else {
      setPendingRule(res.rule)
    }
  }

  function handleConfirmRule() {
    if (!pendingRule) return

    // Calculate next rule ID (e.g. RULE-05)
    let maxNum = 0
    for (const r of rules) {
      const match = r.ruleId?.match(/RULE-(\d+)/i)
      if (match) {
        const num = parseInt(match[1], 10)
        if (num > maxNum) maxNum = num
      }
    }
    const nextRuleId = `RULE-${String(maxNum + 1).padStart(2, '0')}`

    const newRule = {
      ruleId: nextRuleId,
      ...pendingRule,
    }

    const updatedRules = [...rules, newRule]
    setRules(updatedRules)
    setPendingRule(null)
    setNlInput('')
    setNlErrors([])

    // Immediately re-run engine if cart items are loaded
    if (cartItems.length > 0) {
      runCalculation(cartItems, updatedRules)
    }
  }

  function handleDiscardRule() {
    setPendingRule(null)
    setNlErrors([])
  }

  async function handlePdfUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return

    setPdfLoading(true)
    setCartErrors([])

    try {
      const { data, errors } = await parseCartPDF(file)
      setCartItems(data)
      setCartFileName(file.name)
      setCartErrors(errors)

      // Immediately re-run engine if rules are loaded
      if (rules.length > 0 && data.length > 0) {
        runCalculation(data, rules)
      } else {
        setResults(null)
        setCartOffer(null)
      }
    } catch (err) {
      setCartErrors([`PDF Parsing Error: ${err.message}`])
    } finally {
      setPdfLoading(false)
      if (e.target) e.target.value = ''
    }
  }

  const canCalculate = rules.length > 0 && cartItems.length > 0

  // ── Render ──

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={S.header}>
        <div style={S.logoTxt}>O<span style={S.logoSpan}>pp</span>tra</div>
        <div style={S.headerSub}>Discount Engine</div>
      </div>

      <div style={S.main}>

        {/* Upload row */}
        <div style={S.grid2}>
          {/* Rules upload */}
          <div style={S.section}>
            <div style={S.sectionTitle}>Discount Rules</div>
            <CsvUploader
              label="rules.csv"
              description="Upload your discount rules CSV"
              onLoad={handleRulesLoad}
              hasData={rules.length > 0}
              fileName={rulesFileName}
            />
            <ErrorBanner errors={rulesErrors} />

            {/* Describe a rule in plain English */}
            <div style={{ marginTop: '1rem', paddingTop: '0.85rem', borderTop: '1px solid #ECECEC' }}>
              <div style={{ fontWeight: 700, fontSize: 12, color: '#131A48', marginBottom: 4 }}>
                Describe a rule in plain English
              </div>
              <form onSubmit={handleParseNLRule} style={{ display: 'flex', gap: '0.5rem', marginTop: 6 }}>
                <input
                  type="text"
                  placeholder="e.g. 10% off on entire cart over Rs.4000, or 15% off Amazon India"
                  value={nlInput}
                  onChange={(e) => setNlInput(e.target.value)}
                  disabled={nlLoading}
                  style={{
                    flex: 1,
                    padding: '0.5rem 0.75rem',
                    fontSize: 12,
                    border: '1px solid #CECECE',
                    borderRadius: 4,
                    outline: 'none',
                    color: '#131A48',
                  }}
                />
                <button
                  type="submit"
                  disabled={nlLoading || !nlInput.trim()}
                  style={nlLoading || !nlInput.trim() ? S.btnDisabledSmall : S.btnSmall}
                >
                  {nlLoading ? 'Parsing...' : 'Parse Rule'}
                </button>
              </form>

              <ErrorBanner errors={nlErrors} />

              {/* Confirm Parsed Rule Card */}
              {pendingRule && (
                <div
                  style={{
                    marginTop: '0.75rem',
                    padding: '0.85rem',
                    background: '#f8f9fc',
                    border: '1px solid #c5cde3',
                    borderLeft: '4px solid #131A48',
                    borderRadius: 4,
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: 12, color: '#131A48', marginBottom: 6 }}>
                    Confirm Parsed Rule
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.35rem', fontSize: 11, color: '#333' }}>
                    <div>
                      <strong>Scope:</strong> {pendingRule.scope ? pendingRule.scope.charAt(0).toUpperCase() + pendingRule.scope.slice(1) : '—'}
                    </div>
                    <div>
                      <strong>Applies To:</strong> {pendingRule.appliesTo || '—'}
                    </div>
                    <div>
                      <strong>Type:</strong> {pendingRule.type ? pendingRule.type.charAt(0).toUpperCase() + pendingRule.type.slice(1) : '—'}
                    </div>
                    <div>
                      <strong>Value:</strong> {pendingRule.type === 'percentage' ? `${pendingRule.value}% off` : `Rs.${pendingRule.value} off`}
                    </div>
                    <div>
                      <strong>Condition:</strong> {pendingRule.scope === 'cart' && pendingRule.minCartValue ? `Cart >= Rs.${Number(pendingRule.minCartValue).toLocaleString('en-IN')}` : '—'}
                    </div>
                    <div>
                      <strong>Stackable:</strong> {pendingRule.stackable ? 'Yes' : 'No'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                    <button
                      type="button"
                      onClick={handleConfirmRule}
                      style={{
                        background: '#1e5c2c',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 4,
                        padding: '0.4rem 0.9rem',
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      Confirm & Add Rule
                    </button>
                    <button
                      type="button"
                      onClick={handleDiscardRule}
                      style={{
                        background: '#fff',
                        color: '#666',
                        border: '1px solid #CECECE',
                        borderRadius: 4,
                        padding: '0.4rem 0.9rem',
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      Discard
                    </button>
                  </div>
                </div>
              )}
            </div>

            {rules.length > 0 && (
              <div style={{ marginTop: '0.85rem' }}>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>
                  {rules.length} rule{rules.length > 1 ? 's' : ''} loaded
                </div>
                <DataTable columns={RULES_COLUMNS} rows={rules} />
              </div>
            )}
          </div>

          {/* Cart upload */}
          <div style={S.section}>
            <div style={S.sectionTitle}>Cart Items</div>
            <CsvUploader
              label="cart.csv"
              description="Upload your cart CSV"
              onLoad={handleCartLoad}
              hasData={cartItems.length > 0}
              fileName={cartFileName}
            />

            {/* Upload Cart PDF */}
            <div style={{ marginTop: '0.75rem' }}>
              <input
                ref={pdfInputRef}
                type="file"
                accept="application/pdf,.pdf"
                style={{ display: 'none' }}
                onChange={handlePdfUpload}
              />
              <button
                type="button"
                onClick={() => pdfInputRef.current?.click()}
                disabled={pdfLoading}
                style={{
                  width: '100%',
                  background: '#fff',
                  color: '#131A48',
                  border: '1px solid #131A48',
                  borderRadius: 4,
                  padding: '0.55rem 1rem',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: pdfLoading ? 'wait' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.4rem',
                  transition: 'background 0.15s',
                }}
              >
                <span>📑</span>
                <span>{pdfLoading ? 'Parsing PDF Cart...' : 'Upload Cart PDF'}</span>
              </button>
            </div>

            <ErrorBanner errors={cartErrors} />

            {cartItems.length > 0 && (
              <div style={{ marginTop: '0.85rem' }}>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>
                  {cartItems.length} item{cartItems.length > 1 ? 's' : ''} loaded
                </div>
                <DataTable columns={CART_COLUMNS} rows={cartItems} />
              </div>
            )}
          </div>
        </div>

        {/* Calculate button */}
        <div style={{ textAlign: 'center', marginBottom: '1.2rem' }}>
          <button
            style={canCalculate ? S.btn : S.btnDisabled}
            onClick={handleCalculate}
            disabled={!canCalculate}
          >
            Calculate Discounts
          </button>
          {!canCalculate && (
            <div style={{ fontSize: 11, color: '#888', marginTop: 6 }}>
              Upload both files to calculate
            </div>
          )}
        </div>

        {/* Results */}
        {results && (
          <div style={S.section}>
            <div style={S.sectionTitle}>Cart Summary</div>
            <DataTable columns={RESULTS_COLUMNS} rows={results} />

            <div style={{ marginTop: '1rem', paddingTop: '0.75rem', borderTop: '2px solid #131A48' }}>
              {cartOffer ? (
                <>
                  {/* Cart Total before offer */}
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'flex-end',
                      alignItems: 'center',
                      gap: '1rem',
                      marginBottom: '0.5rem',
                    }}
                  >
                    <span style={{ fontSize: 13, color: '#555', fontWeight: 600 }}>Cart Total</span>
                    <span style={{ fontSize: 14, color: '#555', fontWeight: 600 }}>
                      Rs.{cartOffer.subtotal.toLocaleString('en-IN')}
                    </span>
                  </div>

                  {/* Highlighted green Cart Offer row */}
                  <div
                    style={{
                      background: '#e8f5e9',
                      border: '1px solid #a5d6a7',
                      borderLeft: '4px solid #2e7d32',
                      borderRadius: 4,
                      padding: '0.55rem 0.9rem',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '0.65rem',
                    }}
                  >
                    <span style={{ fontWeight: 700, fontSize: 13, color: '#1e5c2c' }}>
                      {cartOffer.label}
                    </span>
                    <span style={{ fontWeight: 700, fontSize: 14, color: '#1e5c2c' }}>
                      -Rs.{cartOffer.discountAmount.toLocaleString('en-IN')}
                    </span>
                  </div>

                  {/* Final Cart Total */}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '1rem' }}>
                    <span style={S.totalLabel}>Final Cart Total</span>
                    <span style={{ ...S.totalValue, fontSize: 18, color: '#131A48' }}>
                      Rs.{cartOffer.finalCartTotal.toLocaleString('en-IN')}
                    </span>
                  </div>
                </>
              ) : (
                /* Below threshold: hide cart offer row and show only Final Cart Total */
                <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '1rem' }}>
                  <span style={S.totalLabel}>Final Cart Total</span>
                  <span style={{ ...S.totalValue, fontSize: 18, color: '#131A48' }}>
                    Rs.{cartTotal(results).toLocaleString('en-IN')}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
