/**
 * pdfCartAdapter.js
 *
 * Adapter for extracting CartItem records from PDF orders.
 * Completely decoupled from discountEngine.js.
 *
 * Uses pdfjs-dist with Vite worker URL compatibility.
 * Features:
 * - Pure `rowsToCartItems` function extracted for direct unit-testing
 * - Coordinates-based (x, y) text extraction
 * - Header detection and X-anchor column alignment
 * - Skips metadata and footer lines (Order #, Date:, Total, etc.)
 * - Strips currency symbols (Rs., ₹) and commas from prices
 * - Warns on decimal rounding
 * - Detects scanned PDFs without a text layer
 * - Validates file size (max 5 MB) and MIME type
 * - Auto-assigns sequential ITEM-01, ITEM-02, etc. IDs
 * - Graceful error handling: skips malformed rows with descriptive warnings
 */

import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

// Set worker source for Vite environments
if (pdfjsLib.GlobalWorkerOptions) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl
}

// Polyfill Uint8Array.prototype.toHex if needed by pdfjs-dist in some environments
if (typeof Uint8Array !== 'undefined' && !Uint8Array.prototype.toHex) {
  Uint8Array.prototype.toHex = function () {
    return Array.from(this)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }
}

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5 MB

/**
 * Pure function: converts an array of row objects into typed CartItem[] and warnings.
 *
 * Each row is an array of text tokens: [{ str, x, y }, ...]
 *
 * @param {Array<Array<{ str: string, x: number, y?: number }>>} rows
 * @returns {{ data: Array<{ itemId: string, product: string, brand: string, platform: string, basePrice: number }>, warnings: string[], errors: string[] }}
 */
export function rowsToCartItems(rows) {
  const data = []
  const warnings = []
  const errors = []

  let activeColAnchors = null
  let itemCounter = 1
  let totalRowsScanned = 0

  for (let rIdx = 0; rIdx < rows.length; rIdx++) {
    const rawRow = rows[rIdx]
    if (!rawRow || rawRow.length === 0) continue

    // Ensure items in row are sorted left-to-right by x
    const row = [...rawRow].sort((a, b) => a.x - b.x)
    const rowText = row.map((it) => it.str).join(' ').trim()
    if (!rowText) continue

    const lowerText = rowText.toLowerCase()
    const hasProduct = lowerText.includes('product')
    const hasBrand = lowerText.includes('brand')
    const hasPlatform = lowerText.includes('platform')
    const hasPrice = lowerText.includes('price')

    // Detect header row
    if (hasProduct && hasBrand && hasPlatform && hasPrice) {
      let xProduct = null
      let xBrand = null
      let xPlatform = null
      let xPrice = null

      for (const item of row) {
        const s = item.str.toLowerCase()
        if (s.includes('product') && xProduct === null) xProduct = item.x
        else if (s.includes('brand') && xBrand === null) xBrand = item.x
        else if (s.includes('platform') && xPlatform === null) xPlatform = item.x
        else if (s.includes('price') && xPrice === null) xPrice = item.x
      }

      if (
        xProduct !== null &&
        xBrand !== null &&
        xPlatform !== null &&
        xPrice !== null
      ) {
        const anchors = [
          { key: 'product', x: xProduct },
          { key: 'brand', x: xBrand },
          { key: 'platform', x: xPlatform },
          { key: 'price', x: xPrice },
        ].sort((a, b) => a.x - b.x)

        activeColAnchors = {
          anchors,
          div0: (anchors[0].x + anchors[1].x) / 2,
          div1: (anchors[1].x + anchors[2].x) / 2,
          div2: (anchors[2].x + anchors[3].x) / 2,
        }
      }
      continue
    }

    // Skip metadata before table header
    if (!activeColAnchors) {
      continue
    }

    totalRowsScanned++

    // Skip metadata or footer rows
    if (
      /^order\s*#/i.test(rowText) ||
      /^date\s*:/i.test(rowText) ||
      /^total\b/i.test(rowText) ||
      /^subtotal\b/i.test(rowText)
    ) {
      continue
    }

    // Distribute text tokens into column buckets based on x dividers
    const buckets = { product: [], brand: [], platform: [], price: [] }
    const { anchors, div0, div1, div2 } = activeColAnchors

    for (const item of row) {
      if (item.x < div0) {
        buckets[anchors[0].key].push(item.str)
      } else if (item.x < div1) {
        buckets[anchors[1].key].push(item.str)
      } else if (item.x < div2) {
        buckets[anchors[2].key].push(item.str)
      } else {
        buckets[anchors[3].key].push(item.str)
      }
    }

    const product = buckets.product.join(' ').trim()
    const brand = buckets.brand.join(' ').trim()
    const platform = buckets.platform.join(' ').trim()
    const priceRaw = buckets.price.join(' ').trim()

    // Malformed row policy: skip and warn on missing fields
    const missing = []
    if (!product) missing.push('Product')
    if (!brand) missing.push('Brand')
    if (!platform) missing.push('Platform')
    if (!priceRaw) missing.push('Base Price')

    if (missing.length > 0) {
      warnings.push(
        `Row ${totalRowsScanned} ("${product || rowText}") skipped: missing required fields (${missing.join(', ')})`
      )
      continue
    }

    // Clean price string
    const cleanPrice = priceRaw
      .replace(/(?:rs\.?|₹)/gi, '')
      .replace(/,/g, '')
      .trim()
    const basePrice = parseFloat(cleanPrice)

    if (isNaN(basePrice) || basePrice <= 0) {
      warnings.push(
        `Row ${totalRowsScanned} ("${product}") skipped: invalid price "${priceRaw}" (must be a positive number)`
      )
      continue
    }

    // Warn if decimals were rounded to whole rupees
    if (cleanPrice.includes('.') && basePrice % 1 !== 0) {
      warnings.push(
        `Row ${totalRowsScanned} ("${product}"): price Rs.${cleanPrice} had decimals and was rounded to Rs.${Math.round(basePrice)}`
      )
    }

    const itemId = `ITEM-${String(itemCounter).padStart(2, '0')}`
    itemCounter++

    data.push({
      itemId,
      product,
      brand,
      platform,
      basePrice: Math.round(basePrice),
    })
  }

  if (!activeColAnchors) {
    errors.push(
      'Could not locate table header with columns Product, Brand, Platform, Base Price.'
    )
  } else if (data.length === 0) {
    errors.push('No valid cart items could be extracted from the table.')
  }

  return { data, warnings, errors }
}

/**
 * Parses a PDF file containing a cart items table.
 *
 * @param {File|Blob|ArrayBuffer|Uint8Array} file
 * @returns {Promise<{ data: Array<{ itemId: string, product: string, brand: string, platform: string, basePrice: number }>, warnings: string[], errors: string[] }>}
 */
export async function parseCartPDF(file) {
  // Validate file size and type
  if (file && typeof file.size === 'number' && file.size > MAX_FILE_SIZE) {
    return {
      data: [],
      warnings: [],
      errors: [`File size exceeds the 5 MB limit (${(file.size / (1024 * 1024)).toFixed(1)} MB).`],
    }
  }

  if (file && file.name && !file.name.toLowerCase().endsWith('.pdf')) {
    return {
      data: [],
      warnings: [],
      errors: ['Invalid file type. Please upload a .pdf file.'],
    }
  }

  let arrayBuffer
  try {
    if (file instanceof ArrayBuffer) {
      arrayBuffer = file
    } else if (file instanceof Uint8Array) {
      arrayBuffer = file.buffer
    } else if (file && typeof file.arrayBuffer === 'function') {
      arrayBuffer = await file.arrayBuffer()
    } else {
      return {
        data: [],
        warnings: [],
        errors: ['Invalid file provided. Please upload a valid PDF file.'],
      }
    }
  } catch (err) {
    return {
      data: [],
      warnings: [],
      errors: [`Failed to read PDF file: ${err.message}`],
    }
  }

  let pdfDoc
  try {
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(arrayBuffer),
      isEvalSupported: false,
      useSystemFonts: true,
    })
    pdfDoc = await loadingTask.promise
  } catch (err) {
    return {
      data: [],
      warnings: [],
      errors: [`Failed to parse PDF document: ${err.message}`],
    }
  }

  const allRows = []
  let totalTextItemsCount = 0

  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    let page
    let textContent
    try {
      page = await pdfDoc.getPage(pageNum)
      textContent = await page.getTextContent()
    } catch (pageErr) {
      return {
        data: [],
        warnings: [],
        errors: [`Page ${pageNum}: failed to extract text (${pageErr.message})`],
      }
    }

    const rawItems = (textContent.items || [])
      .filter((it) => it.str && it.str.trim() !== '')
      .map((it) => ({
        str: it.str.trim(),
        x: it.transform[4],
        y: it.transform[5],
      }))

    totalTextItemsCount += rawItems.length
    if (rawItems.length === 0) continue

    // Group items into rows by vertical baseline (y descending)
    rawItems.sort((a, b) => b.y - a.y)

    const Y_TOLERANCE = 5
    let currentRow = []
    let currentY = null

    for (const item of rawItems) {
      if (currentY === null) {
        currentRow.push(item)
        currentY = item.y
      } else if (Math.abs(item.y - currentY) <= Y_TOLERANCE) {
        currentRow.push(item)
      } else {
        allRows.push(currentRow)
        currentRow = [item]
        currentY = item.y
      }
    }
    if (currentRow.length > 0) {
      allRows.push(currentRow)
    }
  }

  // Scanned PDF detection: no text layer found
  if (totalTextItemsCount === 0) {
    return {
      data: [],
      warnings: ['This PDF looks scanned — no text could be extracted.'],
      errors: ['This PDF looks scanned — no text could be extracted.'],
    }
  }

  const result = rowsToCartItems(allRows)
  return result
}
