import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { parseRulesCSV, parseCartCSV } from './csvParser.js'
import {
  applyDiscounts,
  processCart,
  cartTotal,
  evaluateCartOffer,
  calculateDiscountAmount,
} from './discountEngine.js'

describe('discountEngine', () => {
  // Load sample dataset
  const rulesCsvPath = path.resolve(__dirname, '../../sample-data/rules.csv')
  const cartCsvPath = path.resolve(__dirname, '../../sample-data/cart.csv')
  const rulesCsvText = fs.readFileSync(rulesCsvPath, 'utf8')
  const cartCsvText = fs.readFileSync(cartCsvPath, 'utf8')

  const { data: sampleRules } = parseRulesCSV(rulesCsvText)
  const { data: sampleCart } = parseCartCSV(cartCsvText)

  it('evaluates the full sample dataset matching all expected prices and totals', () => {
    const itemResults = processCart(sampleCart, sampleRules)

    expect(itemResults).toHaveLength(6)

    // ITEM-01: Cushion Cover | Natura Casa | Amazon India | 1299 => 1104
    expect(itemResults[0].itemId).toBe('ITEM-01')
    expect(itemResults[0].finalPrice).toBe(1104)
    expect(itemResults[0].totalDiscount).toBe(195)

    // ITEM-02: Bed Sheet Set | Natura Casa | Flipkart | 849 => 629
    expect(itemResults[1].itemId).toBe('ITEM-02')
    expect(itemResults[1].finalPrice).toBe(629)
    expect(itemResults[1].totalDiscount).toBe(220)

    // ITEM-03: Wall Shelf | LivSpace Pro | Amazon India | 599 => 509
    expect(itemResults[2].itemId).toBe('ITEM-03')
    expect(itemResults[2].finalPrice).toBe(509)
    expect(itemResults[2].totalDiscount).toBe(90)

    // ITEM-04: Ceramic Vase | LivSpace Pro | Noon | 2499 => 2499
    expect(itemResults[3].itemId).toBe('ITEM-04')
    expect(itemResults[3].finalPrice).toBe(2499)
    expect(itemResults[3].totalDiscount).toBe(0)

    // ITEM-05: Cutting Board | Nordic Basics | Amazon India | 449 => 382
    expect(itemResults[4].itemId).toBe('ITEM-05')
    expect(itemResults[4].finalPrice).toBe(382)
    expect(itemResults[4].totalDiscount).toBe(67)

    // ITEM-06: Desk Organiser | Nordic Basics | Flipkart | 899 => 809
    expect(itemResults[5].itemId).toBe('ITEM-06')
    expect(itemResults[5].finalPrice).toBe(809)
    expect(itemResults[5].totalDiscount).toBe(90)

    // Cart Total (subtotal of final prices)
    const subtotal = cartTotal(itemResults)
    expect(subtotal).toBe(5932)

    // Cart Offer
    const offer = evaluateCartOffer(itemResults, sampleRules)
    expect(offer).not.toBeNull()
    expect(offer.ruleId).toBe('RULE-04')
    expect(offer.discountAmount).toBe(593)
    expect(offer.finalCartTotal).toBe(5339)
    expect(offer.label).toBe('Cart offer (RULE-04): 10% off — Rs.593 saved')
  })

  it('ITEM-01 max-discount: percentage rule beats flat rule and notes comparison in reasoning', () => {
    const item = {
      itemId: 'ITEM-01',
      product: 'Cushion Cover',
      brand: 'Natura Casa',
      platform: 'Amazon India',
      basePrice: 1299,
    }
    const res = applyDiscounts(item, sampleRules)
    expect(res.finalPrice).toBe(1104)
    expect(res.appliedRules).toEqual(['RULE-01'])
    expect(res.skippedRules).toEqual(['RULE-02'])
    expect(res.reasoning).toBe(
      '15% Amazon India offer applied (Rs.195 saved) — beat the Rs.150 Natura Casa offer.'
    )
  })

  it('ITEM-02 stacks winning non-stackable rule and stackable rule in deterministic order', () => {
    const item = {
      itemId: 'ITEM-02',
      product: 'Bed Sheet Set',
      brand: 'Natura Casa',
      platform: 'Flipkart',
      basePrice: 849,
    }
    const res = applyDiscounts(item, sampleRules)
    expect(res.finalPrice).toBe(629)
    expect(res.appliedRules).toEqual(['RULE-02', 'RULE-03'])
    expect(res.reasoning).toBe(
      'Rs.150 Natura Casa offer applied. Plus 10% Flipkart offer stacked (Rs.70 saved).'
    )
  })

  it('applies stackable-only discount when no non-stackable rule matches', () => {
    const item = {
      itemId: 'ITEM-99',
      product: 'Gaming Mouse',
      brand: 'Logitech',
      platform: 'Flipkart',
      basePrice: 1000,
    }
    const res = applyDiscounts(item, sampleRules)
    expect(res.finalPrice).toBe(900)
    expect(res.totalDiscount).toBe(100)
    expect(res.appliedRules).toEqual(['RULE-03'])
    expect(res.reasoning).toBe('10% Flipkart offer applied (Rs.100 saved).')
  })

  it('returns base price and "No offers available" when no rule matches', () => {
    const item = {
      itemId: 'ITEM-04',
      product: 'Ceramic Vase',
      brand: 'LivSpace Pro',
      platform: 'Noon',
      basePrice: 2499,
    }
    const res = applyDiscounts(item, sampleRules)
    expect(res.finalPrice).toBe(2499)
    expect(res.totalDiscount).toBe(0)
    expect(res.appliedRules).toEqual([])
    expect(res.reasoning).toBe('No offers available')
  })

  it('tie-break: when two non-stackable rules give the exact same rupee saving, picks the first in rule order', () => {
    const item = {
      itemId: 'TIE-01',
      product: 'Smart Watch',
      brand: 'Titan',
      platform: 'TataCliq',
      basePrice: 1000,
    }
    const tieRules = [
      {
        ruleId: 'RULE-T1',
        scope: 'brand',
        appliesTo: 'Titan',
        type: 'flat',
        value: 100,
        stackable: false,
      },
      {
        ruleId: 'RULE-T2',
        scope: 'platform',
        appliesTo: 'TataCliq',
        type: 'percentage',
        value: 10, // 10% of 1000 = 100
        stackable: false,
      },
    ]

    const res = applyDiscounts(item, tieRules)
    expect(res.appliedRules).toEqual(['RULE-T1'])
    expect(res.skippedRules).toEqual(['RULE-T2'])
    expect(res.finalPrice).toBe(900)
    expect(res.reasoning).toBe('Rs.100 Titan offer applied — beat the 10% TataCliq offer.')
  })

  it('caps flat discount at item price: finalPrice never drops below 0 and totalDiscount equals basePrice', () => {
    const item = {
      itemId: 'ITEM-CAP',
      product: 'Pen',
      brand: 'Parker',
      platform: 'Amazon India',
      basePrice: 300,
    }
    const rules = [
      {
        ruleId: 'RULE-BIG',
        scope: 'brand',
        appliesTo: 'Parker',
        type: 'flat',
        value: 500, // larger than base price of 300
        stackable: false,
      },
    ]

    const res = applyDiscounts(item, rules)
    expect(res.finalPrice).toBe(0)
    expect(res.totalDiscount).toBe(300)
    expect(res.reasoning).toBe('Rs.500 Parker offer applied (Rs.300 saved).')
  })

  it('cart threshold boundary: 3,999 => no cart offer; 4,000 => offer applies', () => {
    const rules = [
      {
        ruleId: 'RULE-04',
        scope: 'cart',
        appliesTo: 'Entire cart',
        type: 'percentage',
        value: 10,
        stackable: false,
        minCartValue: 4000,
      },
    ]

    const belowThreshold = [{ itemId: '1', finalPrice: 3999 }]
    expect(evaluateCartOffer(belowThreshold, rules)).toBeNull()

    const atThreshold = [{ itemId: '1', finalPrice: 4000 }]
    const offer = evaluateCartOffer(atThreshold, rules)
    expect(offer).not.toBeNull()
    expect(offer.subtotal).toBe(4000)
    expect(offer.discountAmount).toBe(400)
    expect(offer.finalCartTotal).toBe(3600)
  })

  it('multiple cart rules: best saving wins', () => {
    const cartRules = [
      {
        ruleId: 'CART-10',
        scope: 'cart',
        appliesTo: 'Entire cart',
        type: 'percentage',
        value: 10, // 10% of 5000 = 500
        minCartValue: 4000,
      },
      {
        ruleId: 'CART-FLAT',
        scope: 'cart',
        appliesTo: 'Entire cart',
        type: 'flat',
        value: 600, // Rs.600 flat beats Rs.500
        minCartValue: 4000,
      },
    ]

    const items = [{ itemId: '1', finalPrice: 5000 }]
    const offer = evaluateCartOffer(items, cartRules)
    expect(offer.ruleId).toBe('CART-FLAT')
    expect(offer.discountAmount).toBe(600)
    expect(offer.finalCartTotal).toBe(4400)
  })

  it('newly added NL-style rule (20% Natura Casa stackable) updates sample cart results correctly', () => {
    const nlRule = {
      ruleId: 'RULE-05',
      scope: 'brand',
      appliesTo: 'Natura Casa',
      type: 'percentage',
      value: 20,
      stackable: true,
      minCartValue: null,
    }

    const extendedRules = [...sampleRules, nlRule]
    const itemResults = processCart(sampleCart, extendedRules)

    // ITEM-01: 1299 -> winner 15% (195) => 1104 -> stackable 20% (221) => 883
    expect(itemResults[0].finalPrice).toBe(883)
    expect(itemResults[0].reasoning).toBe(
      '15% Amazon India offer applied (Rs.195 saved) — beat the Rs.150 Natura Casa offer. Plus 20% Natura Casa offer stacked (Rs.221 saved).'
    )

    // ITEM-02: 849 -> winner flat 150 => 699 -> 10% (70) => 629 -> 20% (126) => 503
    expect(itemResults[1].finalPrice).toBe(503)
    expect(itemResults[1].reasoning).toBe(
      'Rs.150 Natura Casa offer applied. Plus stacked: 10% Flipkart offer (Rs.70) and 20% Natura Casa offer (Rs.126).'
    )

    // Other items untouched
    expect(itemResults[2].finalPrice).toBe(509)
    expect(itemResults[3].finalPrice).toBe(2499)
    expect(itemResults[4].finalPrice).toBe(382)
    expect(itemResults[5].finalPrice).toBe(809)

    // Cart total (subtotal)
    const subtotal = cartTotal(itemResults)
    expect(subtotal).toBe(5585)

    // Cart offer: 10% of 5585 = 559
    const offer = evaluateCartOffer(itemResults, extendedRules)
    expect(offer.discountAmount).toBe(559)
    expect(offer.finalCartTotal).toBe(5026)
  })
})
