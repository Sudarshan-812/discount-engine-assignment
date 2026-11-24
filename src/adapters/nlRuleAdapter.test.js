import { describe, it, expect } from 'vitest'
import { validateParsedRule } from './nlRuleAdapter.js'

describe('validateParsedRule', () => {
  it('validates a valid brand rule', () => {
    const raw = {
      scope: 'brand',
      appliesTo: 'Natura Casa',
      type: 'flat',
      value: 150,
      stackable: false,
    }
    const res = validateParsedRule(raw)
    expect(res.ok).toBe(true)
    expect(res.rule).toEqual({
      scope: 'brand',
      appliesTo: 'Natura Casa',
      type: 'flat',
      value: 150,
      stackable: false,
      minCartValue: null,
    })
  })

  it('validates a valid platform rule', () => {
    const raw = {
      scope: 'platform',
      appliesTo: 'Amazon India',
      type: 'percentage',
      value: 15,
      stackable: true,
    }
    const res = validateParsedRule(raw)
    expect(res.ok).toBe(true)
    expect(res.rule.scope).toBe('platform')
    expect(res.rule.appliesTo).toBe('Amazon India')
    expect(res.rule.value).toBe(15)
    expect(res.rule.stackable).toBe(true)
  })

  it('validates a valid cart rule and defaults appliesTo to Entire cart if missing', () => {
    const raw = {
      scope: 'cart',
      type: 'percentage',
      value: 10,
      minCartValue: 4000,
      stackable: false,
    }
    const res = validateParsedRule(raw)
    expect(res.ok).toBe(true)
    expect(res.rule.scope).toBe('cart')
    expect(res.rule.appliesTo).toBe('Entire cart')
    expect(res.rule.minCartValue).toBe(4000)
  })

  it('rejects percentage discounts greater than 100', () => {
    const raw = {
      scope: 'platform',
      appliesTo: 'Flipkart',
      type: 'percentage',
      value: 120,
    }
    const res = validateParsedRule(raw)
    expect(res.ok).toBe(false)
    expect(res.error).toContain('cannot exceed 100%')
  })

  it('rejects discount value <= 0', () => {
    const zeroVal = {
      scope: 'brand',
      appliesTo: 'LivSpace Pro',
      type: 'flat',
      value: 0,
    }
    expect(validateParsedRule(zeroVal).ok).toBe(false)

    const negVal = {
      scope: 'brand',
      appliesTo: 'LivSpace Pro',
      type: 'flat',
      value: -50,
    }
    expect(validateParsedRule(negVal).ok).toBe(false)
  })

  it('rejects unknown scope and unknown type', () => {
    const badScope = {
      scope: 'category',
      appliesTo: 'Electronics',
      type: 'percentage',
      value: 10,
    }
    const resScope = validateParsedRule(badScope)
    expect(resScope.ok).toBe(false)
    expect(resScope.error).toContain('Unknown scope')

    const badType = {
      scope: 'brand',
      appliesTo: 'Nike',
      type: 'bogo',
      value: 10,
    }
    const resType = validateParsedRule(badType)
    expect(resType.ok).toBe(false)
    expect(resType.error).toContain('Unknown discount type')
  })

  it('rejects cart rules missing a positive minCartValue threshold', () => {
    const noMin = {
      scope: 'cart',
      appliesTo: 'Entire cart',
      type: 'percentage',
      value: 10,
      minCartValue: null,
    }
    const res = validateParsedRule(noMin)
    expect(res.ok).toBe(false)
    expect(res.error).toContain('Cart rules require a positive minimum cart value')

    const zeroMin = {
      scope: 'cart',
      appliesTo: 'Entire cart',
      type: 'percentage',
      value: 10,
      minCartValue: 0,
    }
    expect(validateParsedRule(zeroMin).ok).toBe(false)
  })

  it('rejects empty appliesTo for brand and platform rules', () => {
    const emptyBrand = {
      scope: 'brand',
      appliesTo: '   ',
      type: 'flat',
      value: 100,
    }
    const resBrand = validateParsedRule(emptyBrand)
    expect(resBrand.ok).toBe(false)
    expect(resBrand.error).toContain('require a valid target name')

    const emptyPlatform = {
      scope: 'platform',
      appliesTo: '',
      type: 'percentage',
      value: 15,
    }
    const resPlatform = validateParsedRule(emptyPlatform)
    expect(resPlatform.ok).toBe(false)
    expect(resPlatform.error).toContain('require a valid target name')
  })
})
