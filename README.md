# Opptra Discount Engine

[![Live Deployment URL](https://img.shields.io/badge/Live%20Demo-TODO__ADD__VERCEL__URL-orange?style=for-the-badge)](https://discount-engine-ashen.vercel.app/)  
**Loom Walkthrough**: [Watch Loom Demo](https://www.loom.com/share/7758d631231f453fa9c9e4d73be945f8)

A high-performance, deterministic discount evaluation engine built with React, Vite, and an extensible Adapter Architecture. Supports item-level discounts, cart-level threshold offers, natural language rule extraction powered by Gemini, and coordinate-aligned PDF cart parsing.

---

## Quick Start (Run Locally in 3 Steps)

1. **Install dependencies**:
   ```bash
   npm install
   ```
2. **Configure environment**:
   ```bash
   cp .env.example .env.local
   # Set GEMINI_API_KEY (only needed for plain-English natural language rules; CSV and PDF work without it)
   ```
3. **Start local dev server**:
   ```bash
   npm run dev
   ```
   Open `http://localhost:5173` in your browser.

### Running Unit Tests
```bash
npm test
```
Runs the full Vitest suite covering the engine, CSV parser, NL adapter, and PDF adapter.

---

## Security & API Key Isolation

- **Server-Side Only**: The Gemini API key is strictly maintained on the backend. It is never exposed or baked into client browser bundles.
- **Production (Vercel)**: Configure `GEMINI_API_KEY` (and optionally `GEMINI_MODEL`) in **Project Settings > Environment Variables**. Never prefix with `VITE_`.
- **Local Dev**: During `npm run dev`, a dedicated Vite dev server plugin mounts `POST /api/parse-rule` using `loadEnv()`, loading `GEMINI_API_KEY` server-side from `.env.local` directly into the Node proxy without bundling it into client assets.

---

## How to Test the Demo

1. **Upload Rules**:
   - Upload `sample-data/rules.csv` (includes RULE-01 through RULE-04).
   - Or describe a rule in plain English (e.g. `"10% off if cart value is more than Rs.5,000"` or `"Rs.100 flat discount on all Flipkart items"`), inspect the live **Impact Preview**, and click **Confirm & Add Rule**.
2. **Upload Cart**:
   - Upload `sample-data/cart.csv` (CSV format) OR click **Upload Cart PDF** and select `sample-data/cart.pdf`.
3. **Calculate Discounts**:
   - Click **Calculate Discounts** or observe reactive recalculation when adding or removing rules.

---

## Expected Results for Sample Data

| Item | Base Price | Final Price | You Save | Offer Applied |
|---|---|---|---|---|
| ITEM-01 (Cushion Cover) | Rs.1,299 | Rs.1,104 | Rs.195 | 15% Amazon India offer applied (Rs.195 saved) — beat the Rs.150 Natura Casa offer. |
| ITEM-02 (Bed Sheet Set) | Rs.849 | Rs.629 | Rs.220 | Rs.150 Natura Casa offer applied. Plus 10% Flipkart offer stacked (Rs.70 saved). |
| ITEM-03 (Wall Shelf) | Rs.599 | Rs.509 | Rs.90 | 15% Amazon India offer applied (Rs.90 saved). |
| ITEM-04 (Ceramic Vase) | Rs.2,499 | Rs.2,499 | — | No offers available |
| ITEM-05 (Cutting Board) | Rs.449 | Rs.382 | Rs.67 | 15% Amazon India offer applied (Rs.67 saved). |
| ITEM-06 (Desk Organiser) | Rs.899 | Rs.809 | Rs.90 | 10% Flipkart offer applied (Rs.90 saved). |

### Cart-Level Threshold Verification
- **Subtotal after item offers**: Rs.5,932 (>= RULE-04 threshold of Rs.4,000)
- **Cart Offer (RULE-04)**: `Cart offer (RULE-04): 10% off — Rs.593 saved` (-Rs.593)
- **Final Cart Total**: **Rs.5,339**

---

## Decisions, Assumptions & Edge Cases

1. **Rounding per Step**: Each discount calculation step rounds to whole rupees (`Math.round`), ensuring predictable integer rupee calculations that avoid floating-point drift (e.g. 15% of 1299 = 194.85 rounds to Rs.195).
2. **Cart Threshold Calculation**: Minimum cart value (`minCartValue`) is evaluated strictly against the **sum of final item prices** post-item discounts, not original base prices.
3. **Deterministic Stacking & Tie-Breaking**:
   - When multiple non-stackable rules match an item, the rule yielding the largest rupee saving wins.
   - If two non-stackable rules produce the exact same rupee saving, the tie-break deterministically selects the rule that appears **first in rule file order**. The second is listed under `skippedRules`.
   - Stackable rules apply on top of the discounted price in stable rule file order.
4. **Discount Clamping**:
   - Flat discounts larger than the remaining item price are capped at the item price (`discount = Math.min(amount, price)`). An item price can never be negative, and `totalDiscount` always equals `basePrice - finalPrice`.
   - Cart-level offers are capped so the discount cannot exceed the cart subtotal.
5. **Threshold Boundaries**:
   - Cart subtotal of exactly Rs.4,000 qualifies for RULE-04; Rs.3,999 does not.
   - When within reach of a cart rule threshold, a subtle hint ("Add Rs.X more to unlock 10% off your cart") is displayed to incentivize conversion.
6. **PDF Malformed Row Policy**:
   - Malformed rows (missing fields, invalid non-numeric prices) are skipped with descriptive warnings while preserving all valid rows.
   - If a PDF has no valid rows or is a scanned image without a text layer, an error is surfaced and the existing cart is preserved.
   - If prices contain decimals, they round to whole rupees with a logged user warning.
7. **LLM Schema Validation & Defense-in-Depth**:
   - The LLM proxy uses strict temperature 0 and structured JSON schema enforcement.
   - The server re-validates LLM output independently (percentages 1–100, positive values, valid scopes, cart thresholds > 0).
   - Vague inputs (e.g. "Give a discount for big orders") trigger a dedicated friendly guidance card with actionable example phrasings.

---

## Design Disagreements / Alternatives

1. **Confirmation Step Impact Preview**: Plain LLM-to-database insertion is dangerous. The UI calculates a real-time impact preview (`Cart total: Rs.X → Rs.Y (saves Rs.Z more)`) using the pure engine before the rule is committed.
2. **PDF vs Structured Ingestion**: Visual table parsing with coordinate heuristics (`pdfjs-dist`) is sensitive to PDF authoring variations (e.g. scanned bitmaps, non-standard baselines). In production, structured formats (CSV, JSON, EDI, Shopify API) should be the primary ingestion pathway, with PDF parsing treated as a convenience adapter.
3. **Regex Fast-Path vs Pure LLM**: Calling an LLM for simple deterministic inputs (e.g., `"15% off Amazon India"`) introduces unnecessary latency, rate-limiting exposure, and operational cost. A regex pattern matcher fast-path could handle 80% of common discount patterns locally in <1ms, falling back to Gemini only for ambiguous natural language phrasing.

---

## Repository Architecture

```
src/
├── adapters/
│   ├── nlRuleAdapter.js         ← NL Rule Adapter (proxies to /api/parse-rule)
│   ├── nlRuleAdapter.test.js    ← Unit tests for rule validation
│   ├── pdfCartAdapter.js        ← PDF coordinate parsing & rowsToCartItems
│   └── pdfCartAdapter.test.js   ← Unit tests for table parsing & malformed row policy
├── engine/
│   ├── csvParser.js             ← CSV parsing & typed object mapping
│   ├── discountEngine.js        ← Pure deterministic engine (no UI / no IO)
│   ├── discountEngine.test.js   ← Comprehensive engine test suite
│   └── formatters.js            ← Centralised formatRupees currency helper
├── components/
│   ├── CsvUploader.jsx          ← Drag-and-drop CSV upload component
│   ├── DataTable.jsx            ← Reusable accessible data table
│   └── ErrorBanner.jsx          ← Accessible error banner with aria-live
├── App.jsx                      ← State orchestration, UI styling & live impact preview
api/
└── parse-rule.js                ← Vercel serverless proxy (Gemini API with secret key)
sample-data/
├── cart.csv                     ← Sample cart CSV
├── cart.pdf                     ← Sample cart PDF (generated with metadata & table)
└── rules.csv                    ← Sample rules CSV (includes RULE-04 cart threshold)
vite.config.js                   ← Local Vite dev server plugin mounting /api/parse-rule
```

---

## License
MIT
