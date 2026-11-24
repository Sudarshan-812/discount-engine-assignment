import { describe, it, expect } from 'vitest'
import { rowsToCartItems } from './pdfCartAdapter.js'

describe('rowsToCartItems', () => {
  // Common column header row fixture
  const headerRow = [
    { str: 'Product', x: 50 },
    { str: 'Brand', x: 180 },
    { str: 'Platform', x: 310 },
    { str: 'Base Price', x: 450 },
  ]

  it('parses the happy path (6 items matching sample cart)', () => {
    const rows = [
      [{ str: 'Order #OP-9921', x: 50 }],
      [{ str: 'Date: 15 Jan 2025', x: 50 }],
      headerRow,
      [
        { str: 'Cushion Cover', x: 50 },
        { str: 'Natura Casa', x: 180 },
        { str: 'Amazon India', x: 310 },
        { str: 'Rs.1,299', x: 450 },
      ],
      [
        { str: 'Bed Sheet Set', x: 50 },
        { str: 'Natura Casa', x: 180 },
        { str: 'Flipkart', x: 310 },
        { str: 'Rs.849', x: 450 },
      ],
      [
        { str: 'Wall Shelf', x: 50 },
        { str: 'LivSpace Pro', x: 180 },
        { str: 'Amazon India', x: 310 },
        { str: 'Rs.599', x: 450 },
      ],
      [
        { str: 'Ceramic Vase', x: 50 },
        { str: 'LivSpace Pro', x: 180 },
        { str: 'Noon', x: 310 },
        { str: 'Rs.2,499', x: 450 },
      ],
      [
        { str: 'Cutting Board', x: 50 },
        { str: 'Nordic Basics', x: 180 },
        { str: 'Amazon India', x: 310 },
        { str: 'Rs.449', x: 450 },
      ],
      [
        { str: 'Desk Organiser', x: 50 },
        { str: 'Nordic Basics', x: 180 },
        { str: 'Flipkart', x: 310 },
        { str: 'Rs.899', x: 450 },
      ],
      [
        { str: 'Total', x: 310 },
        { str: 'Rs.6,594', x: 450 },
      ],
    ]

    const res = rowsToCartItems(rows)
    expect(res.errors).toHaveLength(0)
    expect(res.warnings).toHaveLength(0)
    expect(res.data).toHaveLength(6)

    expect(res.data[0]).toEqual({
      itemId: 'ITEM-01',
      product: 'Cushion Cover',
      brand: 'Natura Casa',
      platform: 'Amazon India',
      basePrice: 1299,
    })
    expect(res.data[5]).toEqual({
      itemId: 'ITEM-06',
      product: 'Desk Organiser',
      brand: 'Nordic Basics',
      platform: 'Flipkart',
      basePrice: 899,
    })
  })

  it('skips a row missing Brand and reports a descriptive warning', () => {
    const rows = [
      headerRow,
      [
        { str: 'Cushion Cover', x: 50 },
        // brand missing
        { str: 'Amazon India', x: 310 },
        { str: 'Rs.1,299', x: 450 },
      ],
      [
        { str: 'Wall Shelf', x: 50 },
        { str: 'LivSpace Pro', x: 180 },
        { str: 'Amazon India', x: 310 },
        { str: 'Rs.599', x: 450 },
      ],
    ]

    const res = rowsToCartItems(rows)
    expect(res.data).toHaveLength(1)
    expect(res.data[0].product).toBe('Wall Shelf')
    expect(res.warnings).toHaveLength(1)
    expect(res.warnings[0]).toContain('missing required fields (Brand)')
  })

  it('skips a row with invalid price string (Rs.abc)', () => {
    const rows = [
      headerRow,
      [
        { str: 'Coffee Mug', x: 50 },
        { str: 'Ceramica', x: 180 },
        { str: 'Flipkart', x: 310 },
        { str: 'Rs.abc', x: 450 },
      ],
    ]

    const res = rowsToCartItems(rows)
    expect(res.data).toHaveLength(0)
    expect(res.warnings).toHaveLength(1)
    expect(res.warnings[0]).toContain('invalid price "Rs.abc"')
  })

  it('skips negative and zero prices', () => {
    const rows = [
      headerRow,
      [
        { str: 'Free Sample', x: 50 },
        { str: 'Brand X', x: 180 },
        { str: 'Flipkart', x: 310 },
        { str: 'Rs.0', x: 450 },
      ],
      [
        { str: 'Gift Card', x: 50 },
        { str: 'Brand Y', x: 180 },
        { str: 'Amazon', x: 310 },
        { str: '-Rs.100', x: 450 },
      ],
    ]

    const res = rowsToCartItems(rows)
    expect(res.data).toHaveLength(0)
    expect(res.warnings).toHaveLength(2)
  })

  it('ignores metadata rows and footer Total rows', () => {
    const rows = [
      [{ str: 'Order #OP-1234', x: 50 }],
      [{ str: 'Date: 01 Dec 2024', x: 50 }],
      headerRow,
      [
        { str: 'Lamp', x: 50 },
        { str: 'Ikea', x: 180 },
        { str: 'Amazon', x: 310 },
        { str: '1500', x: 450 },
      ],
      [
        { str: 'Subtotal', x: 310 },
        { str: '1500', x: 450 },
      ],
      [
        { str: 'Total', x: 310 },
        { str: '1500', x: 450 },
      ],
    ]

    const res = rowsToCartItems(rows)
    expect(res.data).toHaveLength(1)
    expect(res.data[0].product).toBe('Lamp')
  })

  it('parses prices with various currency notations (Rs.1,299, ₹1,299, and decimals 1299.50 with warning)', () => {
    const rows = [
      headerRow,
      [
        { str: 'Item A', x: 50 },
        { str: 'Brand A', x: 180 },
        { str: 'Amazon', x: 310 },
        { str: 'Rs.1,299', x: 450 },
      ],
      [
        { str: 'Item B', x: 50 },
        { str: 'Brand B', x: 180 },
        { str: 'Flipkart', x: 310 },
        { str: '₹1,299', x: 450 },
      ],
      [
        { str: 'Item C', x: 50 },
        { str: 'Brand C', x: 180 },
        { str: 'Noon', x: 310 },
        { str: '1299.50', x: 450 },
      ],
    ]

    const res = rowsToCartItems(rows)
    expect(res.data).toHaveLength(3)
    expect(res.data[0].basePrice).toBe(1299)
    expect(res.data[1].basePrice).toBe(1299)
    // 1299.50 rounds to 1300
    expect(res.data[2].basePrice).toBe(1300)
    // Decimal rounding warning recorded
    expect(res.warnings).toHaveLength(1)
    expect(res.warnings[0]).toContain('had decimals and was rounded to Rs.1300')
  })
})
