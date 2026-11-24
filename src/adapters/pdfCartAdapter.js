/**
 * pdfCartAdapter.js
 *
 * Adapter for extracting CartItem records from PDF orders.
 * Completely decoupled from discountEngine.js.
 *
 * Uses pdfjs-dist with Vite worker URL compatibility.
 * Features:
 * - Coordinates-based (x, y) text extraction
 * - Header detection and X-anchor column alignment
 * - Skips metadata and footer lines (Order #, Date:, Total, etc.)
 * - Strips currency symbols (Rs., ₹) and commas from prices
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

/**
 * Parses a PDF file containing a cart items table.
 *
 * Expected table structure:
 * Product | Brand | Platform | Base Price
 *
 * @param {File|Blob|ArrayBuffer|Uint8Array} file
 * @returns {Promise<{ data: Array<{ itemId: string, product: string, brand: string, platform: string, basePrice: number }>, errors: string[] }>}
 */
export async function parseCartPDF(file) {
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
        errors: ['Invalid file provided. Please upload a valid PDF file.'],
      }
    }
  } catch (err) {
    return {
      data: [],
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
      errors: [`Failed to parse PDF document: ${err.message}`],
    }
  }

  const data = []
  const errors = []
  let itemCounter = 1
  let activeColAnchors = null
  let totalRowsScanned = 0

  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    let page
    let textContent
    try {
      page = await pdfDoc.getPage(pageNum)
      textContent = await page.getTextContent()
    } catch (pageErr) {
      errors.push(`Page ${pageNum}: failed to extract text (${pageErr.message})`)
      continue
    }

    // Filter non-empty text items
    const rawItems = (textContent.items || [])
      .filter((it) => it.str && it.str.trim() !== '')
      .map((it) => ({
        str: it.str.trim(),
        x: it.transform[4],
        y: it.transform[5],
      }))

    if (rawItems.length === 0) continue

    // Group items into rows by y coordinate (PDF y is larger towards the top)
    // Sort descending by y so top lines come first
    rawItems.sort((a, b) => b.y - a.y)

    const Y_TOLERANCE = 5
    const rows = []
    let currentRow = []
    let currentY = null

    for (const item of rawItems) {
      if (currentY === null) {
        currentRow.push(item)
        currentY = item.y
      } else if (Math.abs(item.y - currentY) <= Y_TOLERANCE) {
        currentRow.push(item)
      } else {
        rows.push(currentRow)
        currentRow = [item]
        currentY = item.y
      }
    }
    if (currentRow.length > 0) {
      rows.push(currentRow)
    }

    // Sort items within each row left to right (x ascending)
    for (const row of rows) {
      row.sort((a, b) => a.x - b.x)
    }

    for (let rIdx = 0; rIdx < rows.length; rIdx++) {
      const row = rows[rIdx]
      const rowText = row.map((it) => it.str).join(' ').trim()
      if (!rowText) continue

      // Check if this row is the table header
      const lowerText = rowText.toLowerCase()
      const hasProduct = lowerText.includes('product')
      const hasBrand = lowerText.includes('brand')
      const hasPlatform = lowerText.includes('platform')
      const hasPrice = lowerText.includes('price')

      if (hasProduct && hasBrand && hasPlatform && hasPrice) {
        // Detect X coordinates of each column header
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

      // If we haven't found a header yet, skip this row (metadata like Order #, Date, etc.)
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

      // Assign items to columns based on column boundary dividers
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

      // Graceful error handling: check for missing fields
      const missing = []
      if (!product) missing.push('Product')
      if (!brand) missing.push('Brand')
      if (!platform) missing.push('Platform')
      if (!priceRaw) missing.push('Base Price')

      if (missing.length > 0) {
        errors.push(
          `Row ${totalRowsScanned} ("${product || rowText}"): missing required fields (${missing.join(', ')})`
        )
        continue
      }

      // Strip Rs., ₹, commas and spaces from price
      const cleanPrice = priceRaw
        .replace(/(?:rs\.?|₹)/gi, '')
        .replace(/,/g, '')
        .trim()
      const basePrice = parseFloat(cleanPrice)

      if (isNaN(basePrice) || basePrice <= 0) {
        errors.push(
          `Row ${totalRowsScanned} ("${product}"): invalid price "${priceRaw}"`
        )
        continue
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
  }

  if (!activeColAnchors && data.length === 0) {
    errors.push(
      'Could not locate table header with columns Product, Brand, Platform, Base Price.'
    )
  }

  return { data, errors }
}
