/**
 * App.jsx
 *
 * Top-level component. Manages state for rules, cart items, and results.
 * Wires together CSV upload / PDF upload / NL rule parsing → engine → display.
 */

import { useState, useRef, useMemo } from 'react'
import CsvUploader from './components/CsvUploader.jsx'
import DataTable from './components/DataTable.jsx'
import ErrorBanner from './components/ErrorBanner.jsx'
import { parseRulesCSV, parseCartCSV } from './engine/csvParser.js'
import { processCart, cartTotal, evaluateCartOffer } from './engine/discountEngine.js'
import { parseNaturalLanguageRule } from './adapters/nlRuleAdapter.js'
import { parseCartPDF } from './adapters/pdfCartAdapter.js'
import { formatRupees } from './engine/formatters.js'

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
  const [rules, setRules]                         = useState([])
  const [rulesErrors, setRulesErr]                = useState([])
  const [rulesFileName, setRulesFileName]         = useState('')
  const [sessionAddedRuleIds, setSessionAddedIds] = useState(new Set())
  const [rulesNotice, setRulesNotice]             = useState('')

  // Natural Language Rule input state
  const [nlInput, setNlInput]                     = useState('')
  const [nlLoading, setNlLoading]                 = useState(false)
  const [nlError, setNlError]                     = useState(null)
  const [pendingRule, setPendingRule]             = useState(null)

  // Cart state
  const [cartItems, setCartItems]                 = useState([])
  const [cartErrors, setCartErrors]               = useState([])
  const [cartFileName, setCartFileName]           = useState('')
  const [cartSource, setCartSource]               = useState('csv') // 'csv' | 'pdf'
  const [pdfLoading, setPdfLoading]               = useState(false)
  const pdfInputRef                               = useRef(null)

  // Execution & display state
  const [hasCalculated, setHasCalculated]         = useState(false)
  const resultsRef                                = useRef(null)

  // ── Derived results via pure engine (never stale) ──
  const { results, cartOffer } = useMemo(() => {
    if (cartItems.length > 0 && rules.length > 0) {
      const res = processCart(cartItems, rules)
      const offer = evaluateCartOffer(res, rules)
      return { results: res, cartOffer: offer }
    }
    return { results: null, cartOffer: null }
  }, [cartItems, rules])

  // ── Handlers ──

  function handleRemoveRule(ruleId) {
    setRules((prev) => prev.filter((r) => r.ruleId !== ruleId))
    setSessionAddedIds((prev) => {
      const next = new Set(prev)
      next.delete(ruleId)
      return next
    })
  }

  function handleRulesLoad(csvText, fileName) {
    if (sessionAddedRuleIds.size > 0) {
      const ok = window.confirm(
        `Uploading a new rules CSV will replace ${rules.length} active rules, including ${sessionAddedRuleIds.size} added during this session. Proceed?`
      )
      if (!ok) return
    }

    const { data, errors } = parseRulesCSV(csvText)
    setRules(data)
    setRulesErr(errors)
    setRulesFileName(fileName)
    setSessionAddedIds(new Set())
    setRulesNotice(`Loaded ${data.length} rules from ${fileName}.`)
  }

  function handleCartLoad(csvText, fileName) {
    const { data, errors } = parseCartCSV(csvText)
    setCartItems(data)
    setCartErrors(errors)
    setCartFileName(fileName)
    setCartSource('csv')
  }

  function handleCalculate() {
    setHasCalculated(true)
    setTimeout(() => {
      resultsRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, 50)
  }

  async function handleParseNLRule(e) {
    e?.preventDefault()
    if (!nlInput.trim()) return

    setNlLoading(true)
    setNlError(null)
    setPendingRule(null)

    const res = await parseNaturalLanguageRule(nlInput)
    setNlLoading(false)

    if (!res.ok) {
      setNlError(res.error)
    } else {
      setPendingRule(res.rule)
    }
  }

  function handleConfirmRule() {
    if (!pendingRule) return

    // Auto-assign next RULE-NN ID based on max existing number
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

    setRules((prev) => [...prev, newRule])
    setSessionAddedIds((prev) => new Set([...prev, nextRuleId]))
    setPendingRule(null)
    setNlInput('')
    setNlError(null)
    setHasCalculated(true)
  }

  function handleDiscardRule() {
    setPendingRule(null)
    setNlError(null)
  }

  async function handlePdfUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return

    setPdfLoading(true)
    setCartErrors([])

    try {
      const { data, warnings, errors } = await parseCartPDF(file)

      // Malformed row policy: If NO valid rows found, show error and DO NOT replace cart
      if (data.length === 0) {
        setCartErrors(errors.length > 0 ? errors : ['No valid cart items could be extracted from this PDF.'])
        return
      }

      setCartItems(data)
      setCartFileName(file.name)
      setCartSource('pdf')
      setCartErrors([...errors, ...warnings])
      setHasCalculated(true)
    } catch (err) {
      setCartErrors([`PDF Parsing Error: ${err.message}`])
    } finally {
      setPdfLoading(false)
      if (e.target) e.target.value = ''
    }
  }

  // ── Impact preview calculation for pending rule ──
  const impactPreview = useMemo(() => {
    if (!pendingRule || cartItems.length === 0) return null
    const currTotal = cartOffer ? cartOffer.finalCartTotal : cartTotal(results || [])

    const candidate = { ruleId: 'PREVIEW', ...pendingRule }
    const nextRules = [...rules, candidate]
    const nextResults = processCart(cartItems, nextRules)
    const nextOffer = evaluateCartOffer(nextResults, nextRules)
    const nextTotal = nextOffer ? nextOffer.finalCartTotal : cartTotal(nextResults)

    const savingsDiff = currTotal - nextTotal
    return {
      currentTotal: currTotal,
      newTotal: nextTotal,
      savingsDiff,
    }
  }, [pendingRule, cartItems, rules, results, cartOffer])

  // Check if pending rule is duplicate
  const isDuplicateRule = useMemo(() => {
    if (!pendingRule) return false
    return rules.some(
      (r) =>
        r.scope === pendingRule.scope &&
        (r.appliesTo || '').trim().toLowerCase() === (pendingRule.appliesTo || '').trim().toLowerCase() &&
        r.type === pendingRule.type &&
        Number(r.value) === Number(pendingRule.value) &&
        (r.minCartValue ?? null) === (pendingRule.minCartValue ?? null)
    )
  }, [pendingRule, rules])

  // Subtle cart threshold hint
  const cartThresholdHint = useMemo(() => {
    if (cartOffer || !results || results.length === 0) return null
    const subtotal = cartTotal(results)
    const cartRules = rules.filter((r) => r.scope === 'cart' && (r.minCartValue ?? 0) > subtotal)
    if (cartRules.length === 0) return null

    // Pick closest threshold
    const sorted = [...cartRules].sort((a, b) => (a.minCartValue ?? 0) - (b.minCartValue ?? 0))
    const target = sorted[0]
    const diff = (target.minCartValue ?? 0) - subtotal
    if (diff > 0 && diff < target.minCartValue) {
      const offerDesc = target.type === 'percentage' ? `${target.value}% off` : `${formatRupees(target.value)} off`
      return `Add ${formatRupees(diff)} more to unlock ${offerDesc} your cart`
    }
    return null
  }, [cartOffer, results, rules])

  // ── Column definitions with formatRupees ──

  const RULES_COLUMNS = [
    { key: 'ruleId',    label: 'Rule ID' },
    { key: 'scope',     label: 'Scope',      render: (v) => v ? v.charAt(0).toUpperCase() + v.slice(1) : '—' },
    { key: 'appliesTo', label: 'Applies To' },
    { key: 'type',      label: 'Type',       render: (v) => v ? v.charAt(0).toUpperCase() + v.slice(1) : '—' },
    {
      key: 'value',
      label: 'Value',
      render: (v, row) => row.type === 'percentage' ? `${v}% off` : `${formatRupees(v)} off`,
    },
    {
      key: 'minCartValue',
      label: 'Condition',
      render: (v, row) =>
        row.scope === 'cart' && v
          ? `Cart >= ${formatRupees(v)}`
          : '—',
    },
    { key: 'stackable', label: 'Stackable',  render: (v) => (v ? 'Yes' : 'No') },
    {
      key: 'actions',
      label: 'Actions',
      render: (_, row) => (
        <button
          type="button"
          onClick={() => handleRemoveRule(row.ruleId)}
          style={{
            background: '#fff',
            border: '1px solid #c0392b',
            borderRadius: 3,
            color: '#c0392b',
            fontSize: 10,
            padding: '2px 6px',
            cursor: 'pointer',
            fontWeight: 700,
          }}
          title={`Remove ${row.ruleId}`}
          aria-label={`Remove rule ${row.ruleId}`}
        >
          Remove
        </button>
      ),
    },
  ]

  const CART_COLUMNS = [
    { key: 'itemId',    label: 'Item', render: (v) => <span style={{ whiteSpace: 'nowrap' }}>{v}</span> },
    { key: 'product',   label: 'Product' },
    { key: 'brand',     label: 'Brand' },
    { key: 'platform',  label: 'Platform' },
    { key: 'basePrice', label: 'Base Price', render: (v) => formatRupees(v) },
  ]

  const RESULTS_COLUMNS = [
    { key: 'itemId',    label: 'Item', render: (v) => <span style={{ whiteSpace: 'nowrap' }}>{v}</span> },
    { key: 'product',   label: 'Product' },
    { key: 'basePrice', label: 'Base Price',  render: (v) => formatRupees(v) },
    {
      key: 'finalPrice',
      label: 'Final Price',
      render: (v, row) => (
        <span style={{ fontWeight: 700, color: row.totalDiscount > 0 ? '#1e5c2c' : '#131A48' }}>
          {formatRupees(v)}
        </span>
      ),
    },
    {
      key: 'totalDiscount',
      label: 'You Save',
      render: (v) =>
        v > 0 ? (
          <span style={{ color: '#1e5c2c', fontWeight: 600 }}>{formatRupees(v)}</span>
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

  const canCalculate = rules.length > 0 && cartItems.length > 0
  const showResults = (hasCalculated || cartItems.length > 0) && results !== null

  // ── Render ──

  return (
    <div style={S.page}>
      {/* Header */}
      <header style={S.header}>
        <div style={S.logoTxt}>O<span style={S.logoSpan}>pp</span>tra</div>
        <div style={S.headerSub}>Discount Engine</div>
      </header>

      <main style={S.main}>

        {/* Upload row */}
        <div style={S.grid2}>
          {/* Rules panel */}
          <section style={S.section} aria-labelledby="rules-section-title">
            <h2 id="rules-section-title" style={S.sectionTitle}>Discount Rules</h2>
            <CsvUploader
              label="rules.csv"
              description="Upload your discount rules CSV"
              onLoad={handleRulesLoad}
              hasData={rules.length > 0}
              fileName={rulesFileName}
            />
            {rulesNotice && (
              <div style={{ fontSize: 11, color: '#1e5c2c', marginTop: 4 }}>
                ✓ {rulesNotice}
              </div>
            )}
            <ErrorBanner errors={rulesErrors} />

            {/* Describe a rule in plain English */}
            <div style={{ marginTop: '1rem', paddingTop: '0.85rem', borderTop: '1px solid #ECECEC' }}>
              <label htmlFor="nl-input" style={{ display: 'block', fontWeight: 700, fontSize: 12, color: '#131A48', marginBottom: 4 }}>
                Describe a rule in plain English
              </label>
              <form onSubmit={handleParseNLRule} style={{ display: 'flex', gap: '0.5rem', marginTop: 6 }}>
                <input
                  id="nl-input"
                  type="text"
                  placeholder='e.g. "10% off if cart value is more than Rs.5,000"'
                  value={nlInput}
                  onChange={(e) => setNlInput(e.target.value)}
                  disabled={nlLoading}
                  aria-label="Describe a discount rule in plain English"
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

              {/* Improved Unresolvable NL Error Display */}
              {nlError && (
                <div
                  role="alert"
                  aria-live="polite"
                  style={{
                    background: '#fff5f5',
                    border: '1px solid #fed7d7',
                    borderLeft: '4px solid #c53030',
                    borderRadius: 4,
                    padding: '0.75rem 0.9rem',
                    marginTop: '0.65rem',
                    fontSize: 12,
                  }}
                >
                  <div style={{ fontWeight: 700, color: '#9b2c2c', marginBottom: 4 }}>
                    I couldn't turn that into a rule — please be more specific
                  </div>
                  <div style={{ color: '#742a2a', marginBottom: 6 }}>
                    {nlError}
                  </div>
                  <div style={{ color: '#4a5568', fontSize: 11 }}>
                    <strong>Try phrasing like:</strong>
                    <ul style={{ margin: '4px 0 0 1.1rem', padding: 0 }}>
                      <li>"10% off if cart value is more than Rs.5,000"</li>
                      <li>"Rs.100 flat discount on all Flipkart items"</li>
                    </ul>
                  </div>
                </div>
              )}

              {/* Confirm Parsed Rule Card with Impact Preview */}
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

                  {isDuplicateRule && (
                    <div
                      style={{
                        background: '#fffbe6',
                        border: '1px solid #ffe58f',
                        borderRadius: 3,
                        padding: '4px 8px',
                        fontSize: 11,
                        color: '#874d00',
                        marginBottom: 6,
                      }}
                    >
                      ⚠️ Note: A matching rule already exists in your active rules list.
                    </div>
                  )}

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
                      <strong>Value:</strong> {pendingRule.type === 'percentage' ? `${pendingRule.value}% off` : `${formatRupees(pendingRule.value)} off`}
                    </div>
                    <div>
                      <strong>Condition:</strong> {pendingRule.scope === 'cart' && pendingRule.minCartValue ? `Cart >= ${formatRupees(pendingRule.minCartValue)}` : '—'}
                    </div>
                    <div>
                      <strong>Stackable:</strong> {pendingRule.stackable ? 'Yes' : 'No'}
                    </div>
                  </div>

                  {/* Impact preview */}
                  <div
                    style={{
                      marginTop: '0.65rem',
                      padding: '0.45rem 0.65rem',
                      background: '#edf2f7',
                      borderRadius: 4,
                      fontSize: 11,
                      color: '#2d3748',
                    }}
                  >
                    <strong>Impact Preview: </strong>
                    {impactPreview ? (
                      <span>
                        Cart total: {formatRupees(impactPreview.currentTotal)} → {formatRupees(impactPreview.newTotal)}{' '}
                        {impactPreview.savingsDiff > 0 ? (
                          <span style={{ color: '#1e5c2c', fontWeight: 700 }}>
                            (saves {formatRupees(impactPreview.savingsDiff)} more)
                          </span>
                        ) : (
                          <span style={{ color: '#718096' }}>(no change on current cart)</span>
                        )}
                      </span>
                    ) : (
                      <span style={{ fontStyle: 'italic', color: '#718096' }}>
                        Load a cart to preview impact
                      </span>
                    )}
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
                  {rules.length} rule{rules.length > 1 ? 's' : ''} active
                </div>
                <DataTable columns={RULES_COLUMNS} rows={rules} />
              </div>
            )}
          </section>

          {/* Cart panel */}
          <section style={S.section} aria-labelledby="cart-section-title">
            <h2 id="cart-section-title" style={S.sectionTitle}>Cart Items</h2>
            <CsvUploader
              label={cartSource === 'pdf' ? 'cart.pdf' : 'cart.csv'}
              description="Upload your cart CSV or PDF"
              onLoad={handleCartLoad}
              hasData={cartItems.length > 0}
              fileName={cartFileName}
            />

            {/* Upload Cart PDF button */}
            <div style={{ marginTop: '0.75rem' }}>
              <input
                ref={pdfInputRef}
                type="file"
                accept="application/pdf,.pdf"
                style={{ display: 'none' }}
                onChange={handlePdfUpload}
                aria-label="Upload cart PDF file"
              />
              <button
                type="button"
                onClick={() => pdfInputRef.current?.click()}
                disabled={pdfLoading}
                aria-label="Upload Cart PDF"
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
                  {cartItems.length} item{cartItems.length > 1 ? 's' : ''} loaded ({cartSource.toUpperCase()})
                </div>
                <DataTable columns={CART_COLUMNS} rows={cartItems} />
              </div>
            )}
          </section>
        </div>

        {/* Calculate button */}
        <div style={{ textAlign: 'center', marginBottom: '1.2rem' }}>
          <button
            style={canCalculate ? S.btn : S.btnDisabled}
            onClick={handleCalculate}
            disabled={!canCalculate}
            aria-label="Calculate Discounts"
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
        {showResults && (
          <section ref={resultsRef} style={S.section} aria-labelledby="results-title" aria-live="polite">
            <h2 id="results-title" style={S.sectionTitle}>Cart Summary</h2>
            <DataTable columns={RESULTS_COLUMNS} rows={results} />

            <div style={{ marginTop: '1rem', paddingTop: '0.75rem', borderTop: '2px solid #131A48' }}>
              {cartOffer ? (
                <>
                  {/* Subtotal after item offers before cart offer */}
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'flex-end',
                      alignItems: 'center',
                      gap: '1rem',
                      marginBottom: '0.5rem',
                    }}
                  >
                    <span style={{ fontSize: 13, color: '#555', fontWeight: 600 }}>Subtotal after item offers</span>
                    <span style={{ fontSize: 14, color: '#555', fontWeight: 600 }}>
                      {formatRupees(cartOffer.subtotal)}
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
                      -{formatRupees(cartOffer.discountAmount)}
                    </span>
                  </div>

                  {/* Final Cart Total */}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '1rem' }}>
                    <span style={S.totalLabel}>Final Cart Total</span>
                    <span style={{ ...S.totalValue, fontSize: 18, color: '#131A48' }}>
                      {formatRupees(cartOffer.finalCartTotal)}
                    </span>
                  </div>
                </>
              ) : (
                /* Below threshold: hide cart offer row and show only Final Cart Total */
                <>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '1rem' }}>
                    <span style={S.totalLabel}>Final Cart Total</span>
                    <span style={{ ...S.totalValue, fontSize: 18, color: '#131A48' }}>
                      {formatRupees(cartTotal(results))}
                    </span>
                  </div>
                  {cartThresholdHint && (
                    <div
                      style={{
                        textAlign: 'right',
                        fontSize: 12,
                        color: '#666',
                        fontStyle: 'italic',
                        marginTop: 4,
                      }}
                    >
                      💡 {cartThresholdHint}
                    </div>
                  )}
                </>
              )}
            </div>
          </section>
        )}

      </main>
    </div>
  )
}
