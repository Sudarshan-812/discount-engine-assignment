# Opptra Discount Engine

[![Live Deployment URL](https://img.shields.io/badge/Live%20Demo-TODO__ADD__VERCEL__URL-orange?style=for-the-badge)](TODO_ADD_VERCEL_URL)

A high-performance discount evaluation engine built with React, Vite, and an extensible Adapter Architecture. Supports item-level discounts, cart-level threshold offers, natural language rule extraction powered by Gemini 3.5 Flash Lite, and tabular PDF cart parsing with coordinate-based alignment.

---

## Quick Start (Run Locally in 3 Steps)

1. **Install dependencies**:
   ```bash
   npm install
   ```
2. **Configure environment (optional for local NL rule parsing)**:
   ```bash
   cp .env.example .env.local
   # Set VITE_GEMINI_API_KEY in .env.local (and GEMINI_API_KEY for Vercel functions)
   ```
3. **Start local dev server**:
   ```bash
   npm run dev
   ```
   Open `http://localhost:5173` in your browser.

---

## How to Test the Demo

1. **Upload Rules**:
   - Upload `sample-data/rules.csv` (includes RULE-01 through RULE-04).
   - Alternatively, type a natural language rule in the plain English input box (e.g., `"10% off on entire cart over Rs.4000"` or `"15% off on Amazon India"`), click **Parse Rule**, and **Confirm & Add Rule**.
2. **Upload Cart**:
   - Upload `sample-data/cart.csv` (CSV format) OR click **Upload Cart PDF** and select `sample-data/cart.pdf`.
3. **Calculate Discounts**:
   - Click **Calculate Discounts** (or watch it automatically evaluate when modifying rules or uploading files).
   - Verify the Cart Summary breakdown and cart-level offer badge.

---

## Expected Results for Sample Data

| Item | Base Price | Final Price | You Save | Offer Applied |
|---|---|---|---|---|
| ITEM-01 (Cushion Cover) | Rs.1,299 | Rs.1,104 | Rs.195 | Platform offer: 15% off |
| ITEM-02 (Bed Sheet Set) | Rs.849 | Rs.629 | Rs.220 | Brand offer: Rs.150 off + Platform offer: 10% off |
| ITEM-03 (Wall Shelf) | Rs.599 | Rs.509 | Rs.90 | Platform offer: 15% off |
| ITEM-04 (Ceramic Vase) | Rs.2,499 | Rs.2,499 | — | No offers available |
| ITEM-05 (Cutting Board) | Rs.449 | Rs.382 | Rs.67 | Platform offer: 15% off |
| ITEM-06 (Desk Organiser) | Rs.899 | Rs.809 | Rs.90 | Platform offer: 10% off |

### Cart-Level Threshold Verification
- **Cart Total (Item Subtotal)**: Rs.5,932 (exceeds RULE-04 minimum threshold of Rs.4,000)
- **Cart Offer (RULE-04)**: `Cart offer (RULE-04): 10% off — Rs.593 saved` (-Rs.593)
- **Final Cart Total**: **Rs.5,339**

---

## Architecture & Tradeoffs

```
src/
├── adapters/
│   ├── nlRuleAdapter.js    ← Natural Language LLM Adapter (decoupled)
│   └── pdfCartAdapter.js   ← PDF coordinate extraction & column alignment (decoupled)
├── engine/
│   ├── csvParser.js        ← CSV parsing and validation
│   └── discountEngine.js   ← Pure deterministic discount calculation (no UI/IO)
├── components/
│   ├── CsvUploader.jsx     ← Drag-and-drop CSV upload component
│   ├── DataTable.jsx       ← Reusable styled data table
│   └── ErrorBanner.jsx     ← Non-blocking warning/error display
├── App.jsx                 ← State orchestration & Opptra visual UI
api/
└── parse-rule.js           ← Vercel Serverless Function proxy for Gemini API
sample-data/
├── cart.csv                ← Sample cart CSV
├── cart.pdf                ← Sample cart PDF with order metadata & table
└── rules.csv               ← Sample rules CSV (including cart threshold rule)
```

### 1. Adapter Pattern (`nlRuleAdapter`, `pdfCartAdapter`)
The core calculation engine (`discountEngine.js`) remains completely pure, synchronous, and decoupled from input sources, networking, and third-party libraries:
- `nlRuleAdapter.js` handles external AI communication and returns typed rule objects.
- `pdfCartAdapter.js` handles binary PDF parsing, geometry extraction, and returns standard `CartItem[]` arrays.
- Swapping or testing input sources requires zero changes to the discount engine core.

### 2. Vercel Serverless Proxy & Seamless Local Dev Fallback
- **Production Security**: In production (`api/parse-rule.js`), API keys stay hidden on the server using `process.env.GEMINI_API_KEY`. The browser client never touches raw provider secrets.
- **Local Dev DX**: When developers run plain `npm run dev` locally (where Vercel serverless functions are not automatically mounted), `nlRuleAdapter.js` detects the `404` status and falls back to a direct browser call using `import.meta.env.VITE_GEMINI_API_KEY`.

### 3. Strict LLM Schema Validation & Ambiguity Handling
- Gemini 3.5 Flash Lite is invoked with `temperature: 0` and structured JSON enforcement (`responseMimeType: "application/json"`).
- The system prompt strictly requires either a fully resolved rule or `{ "resolvable": false, "reason": "..." }`. The model is instructed **never to hallucinate missing thresholds, brands, or platforms**.
- `validateParsedRule` in `nlRuleAdapter.js` acts as an independent defense-in-depth barrier, validating that percentage values do not exceed 100%, amounts are strictly positive numbers, required fields exist, and cart rules specify a valid minimum cart threshold.

### 4. Robust PDF Geometry Parsing & Graceful Degradation
- `pdfCartAdapter.js` uses `pdfjs-dist` to group text elements by vertical baseline (`y`) within a tolerant threshold.
- Header detection dynamically captures the horizontal anchors (`x`) of `Product`, `Brand`, `Platform`, and `Base Price`, establishing dynamic midpoints between columns.
- Metadata rows (`Order #OP-9921`, `Date: 15 Jan 2025`) and footer rows (`Total`) are detected and ignored.
- Currency symbols (`Rs.`, `₹`) and commas are cleaned before floating-point parsing.
- **Fault-tolerant error handling**: If a single PDF row is corrupt, missing cells, or has an invalid price, the adapter records a descriptive warning in `errors` and continues parsing the remaining valid rows rather than halting execution.

---

## License
MIT
