/**
 * discountEngine.js
 *
 * Pure discount calculation logic. No UI, no side effects.
 * All functions take plain objects and return plain objects.
 *
 * Core Assumptions:
 * 1. Cart-level threshold (minCartValue) is checked against the SUM OF FINAL ITEM PRICES
 *    (post item-level discounts, i.e., after brand and platform rules have been applied).
 * 2. Cart offer is applied as a separate whole-cart discount line, not distributed per item.
 * 3. Each discount calculation step rounds to whole rupees (Math.round), preserving
 *    deterministic integer rupee arithmetic across sequential rules.
 *
 * Data shapes:
 *
 * DiscountRule {
 *   ruleId:       string       — e.g. "RULE-01"
 *   scope:        "brand" | "platform" | "cart"
 *   appliesTo:    string       — e.g. "Natura Casa", "Amazon India", "Entire cart"
 *   type:         "percentage" | "flat"
 *   value:        number       — percentage as integer (15 = 15%), flat in rupees
 *   stackable:    boolean
 *   minCartValue: number|null  — minimum cart subtotal required (cart scope only)
 * }
 *
 * CartItem {
 *   itemId:    string       — e.g. "ITEM-01"
 *   product:   string
 *   brand:     string
 *   platform:  string
 *   basePrice: number       — in rupees
 * }
 *
 * DiscountResult {
 *   itemId:        string
 *   product:       string
 *   brand:         string
 *   platform:      string
 *   basePrice:     number
 *   finalPrice:    number
 *   totalDiscount: number
 *   appliedRules:  string[]
 *   skippedRules:  string[]
 *   reasoning:     string   — customer-readable explanation
 * }
 */

/**
 * Returns true if the rule applies to this cart item.
 */
export function ruleMatchesItem(item, rule) {
  const normalise = (s) => (s ? s.trim().toLowerCase() : '')
  if (rule.scope === 'brand') {
    return normalise(item.brand) === normalise(rule.appliesTo)
  }
  if (rule.scope === 'platform') {
    return normalise(item.platform) === normalise(rule.appliesTo)
  }
  return false
}

/**
 * Calculates the rupee discount a rule gives on a given price.
 * Uses the provided price, not the original base price — important for stacking.
 * Note: Each calculation rounds to whole rupees (e.g. 15% of 1299 = 195).
 */
export function calculateDiscountAmount(price, rule) {
  if (rule.type === 'percentage') {
    return Math.round((price * rule.value) / 100)
  }
  if (rule.type === 'flat') {
    return rule.value
  }
  return 0
}

/**
 * Builds short offer label (e.g. "15% Amazon India offer" or "Rs.150 Natura Casa offer").
 */
function formatRuleShort(rule) {
  const prefix = rule.type === 'percentage' ? `${rule.value}%` : `Rs.${rule.value}`
  const target = rule.appliesTo ? ` ${rule.appliesTo}` : ''
  return `${prefix}${target} offer`
}

/**
 * Builds customer-facing reasoning formatted as short, separate sentences:
 * - Flat offers do not redundantly repeat savings (e.g. "Rs.150 Natura Casa offer applied.").
 * - "beat" is used only for skipped non-stackable rules.
 * - Single stackable: "Plus 20% Natura Casa offer stacked (Rs.221 saved)."
 * - Multiple stackables: "Plus stacked: 10% Flipkart offer (Rs.70) and 20% Natura Casa offer (Rs.126)."
 */
function buildCustomerReasoning(winner, winnerDiscount, skippedRules, appliedStackables) {
  const sentences = []

  if (winner) {
    let mainText = ''
    if (winner.type === 'percentage') {
      mainText = `${formatRuleShort(winner)} applied (Rs.${winnerDiscount} saved)`
    } else {
      if (winnerDiscount < winner.value) {
        mainText = `${formatRuleShort(winner)} applied (Rs.${winnerDiscount} saved)`
      } else {
        mainText = `${formatRuleShort(winner)} applied`
      }
    }

    if (skippedRules.length > 0) {
      mainText += ` — beat the ${formatRuleShort(skippedRules[0])}.`
    } else {
      mainText += '.'
    }
    sentences.push(mainText)

    if (appliedStackables.length === 1) {
      const s = appliedStackables[0]
      sentences.push(`Plus ${formatRuleShort(s.rule)} stacked (Rs.${s.discount} saved).`)
    } else if (appliedStackables.length >= 2) {
      const list = appliedStackables.map((s) => `${formatRuleShort(s.rule)} (Rs.${s.discount})`)
      const joined =
        list.length === 2
          ? `${list[0]} and ${list[1]}`
          : `${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]}`
      sentences.push(`Plus stacked: ${joined}.`)
    }
  } else if (appliedStackables.length > 0) {
    const first = appliedStackables[0]
    let firstText = ''
    if (first.rule.type === 'percentage') {
      firstText = `${formatRuleShort(first.rule)} applied (Rs.${first.discount} saved).`
    } else {
      if (first.discount < first.rule.value) {
        firstText = `${formatRuleShort(first.rule)} applied (Rs.${first.discount} saved).`
      } else {
        firstText = `${formatRuleShort(first.rule)} applied.`
      }
    }
    sentences.push(firstText)

    const remaining = appliedStackables.slice(1)
    if (remaining.length === 1) {
      const s = remaining[0]
      sentences.push(`Plus ${formatRuleShort(s.rule)} stacked (Rs.${s.discount} saved).`)
    } else if (remaining.length >= 2) {
      const list = remaining.map((s) => `${formatRuleShort(s.rule)} (Rs.${s.discount})`)
      const joined =
        list.length === 2
          ? `${list[0]} and ${list[1]}`
          : `${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]}`
      sentences.push(`Plus stacked: ${joined}.`)
    }
  }

  return sentences.join(' ')
}

/**
 * Applies active discount rules to a single cart item.
 * Returns a DiscountResult.
 *
 * Stacking & Tie-breaking logic:
 *   1. Filter all item-level rules matching this item's brand or platform.
 *   2. Among non-stackable rules, evaluate rupee savings on base price (capped at base price).
 *   3. Tie-break: When two non-stackable rules yield the exact same rupee saving,
 *      the rule appearing first in rule order is chosen as the winner; the other is skipped.
 *   4. Apply the winning non-stackable rule first.
 *   5. Apply any stackable rules on top of the discounted price in deterministic rule order.
 *   6. Every discount step caps the discount at the current remaining price (discount = Math.min(amount, price)),
 *      preventing negative item prices.
 */
export function applyDiscounts(item, rules) {
  const matchingRules = rules.filter((r) => ruleMatchesItem(item, r))

  // No rules match — return base price with explanation
  if (matchingRules.length === 0) {
    return {
      itemId: item.itemId,
      product: item.product,
      brand: item.brand,
      platform: item.platform,
      basePrice: item.basePrice,
      finalPrice: item.basePrice,
      totalDiscount: 0,
      appliedRules: [],
      skippedRules: [],
      reasoning: 'No offers available',
    }
  }

  const nonStackable = matchingRules.filter((r) => !r.stackable)
  const stackable = matchingRules.filter((r) => r.stackable)

  // Pick the winning non-stackable rule
  let winner = null
  let skipped = []

  if (nonStackable.length > 0) {
    // Preserve original rules-file index for deterministic tie-breaking
    const withMeta = nonStackable.map((r) => ({
      rule: r,
      saving: Math.min(calculateDiscountAmount(item.basePrice, r), item.basePrice),
      originalIndex: rules.indexOf(r),
    }))

    withMeta.sort((a, b) => {
      // Primary: largest saving in rupees
      if (b.saving !== a.saving) {
        return b.saving - a.saving
      }
      // Tie-break: pick the first in rule file order
      return a.originalIndex - b.originalIndex
    })

    winner = withMeta[0].rule
    skipped = withMeta.slice(1).map((m) => m.rule)
  }

  // Apply winning non-stackable first, then stackable rules deterministically
  let price = item.basePrice
  const appliedRules = []
  let winnerDiscount = 0
  const appliedStackables = []

  if (winner) {
    const rawDiscount = calculateDiscountAmount(price, winner)
    winnerDiscount = Math.min(rawDiscount, price)
    price -= winnerDiscount
    appliedRules.push(winner.ruleId)
  }

  for (const rule of stackable) {
    if (price <= 0) break
    const rawDiscount = calculateDiscountAmount(price, rule)
    const actualDiscount = Math.min(rawDiscount, price)
    price -= actualDiscount
    appliedRules.push(rule.ruleId)
    appliedStackables.push({ rule, discount: actualDiscount })
  }

  const finalPrice = Math.max(0, Math.round(price))
  const totalDiscount = item.basePrice - finalPrice
  const reasoning = buildCustomerReasoning(winner, winnerDiscount, skipped, appliedStackables)

  return {
    itemId: item.itemId,
    product: item.product,
    brand: item.brand,
    platform: item.platform,
    basePrice: item.basePrice,
    finalPrice,
    totalDiscount,
    appliedRules,
    skippedRules: skipped.map((r) => r.ruleId),
    reasoning,
  }
}

/**
 * Runs applyDiscounts across every item in the cart.
 * Returns an array of DiscountResult objects.
 */
export function processCart(cartItems, rules) {
  return cartItems.map((item) => applyDiscounts(item, rules))
}

/**
 * Sums the final prices across all results.
 */
export function cartTotal(results) {
  return results.reduce((sum, r) => sum + r.finalPrice, 0)
}

/**
 * Evaluates cart-level discount offers across all eligible scope === 'cart' rules.
 *
 * Rules:
 * - Subtotal is computed as the sum of final item prices (post item-level discounts).
 * - Finds all cart rules where subtotal >= (rule.minCartValue ?? 0).
 * - If multiple cart rules qualify, the rule yielding the highest rupee saving wins.
 * - Discount is guarded so it can never exceed the cart subtotal.
 *
 * Returns:
 *   { ruleId, subtotal, discountAmount, finalCartTotal, minCartValue, label }
 * or null if no cart rule threshold is met or no cart rules exist.
 */
export function evaluateCartOffer(itemResults, rules) {
  if (!itemResults || itemResults.length === 0 || !rules || rules.length === 0) {
    return null
  }

  const subtotal = cartTotal(itemResults)
  const cartRules = rules.filter(
    (r) => r.scope === 'cart' && subtotal >= (r.minCartValue ?? 0)
  )

  if (cartRules.length === 0) {
    return null
  }

  // If several cart rules are eligible, the highest saving in rupees wins
  let bestRule = null
  let maxDiscount = -1

  for (const rule of cartRules) {
    const rawDiscount = calculateDiscountAmount(subtotal, rule)
    const discount = Math.min(rawDiscount, subtotal)
    if (discount > maxDiscount) {
      maxDiscount = discount
      bestRule = rule
    }
  }

  if (!bestRule) {
    return null
  }

  // Guard: discount can never exceed subtotal
  const discountAmount = Math.min(maxDiscount, subtotal)
  const finalCartTotal = Math.max(0, subtotal - discountAmount)
  const offerTypeDesc =
    bestRule.type === 'percentage'
      ? `${bestRule.value}% off`
      : `Rs.${bestRule.value.toLocaleString('en-IN')} off`
  const label = `Cart offer (${bestRule.ruleId}): ${offerTypeDesc} — Rs.${discountAmount.toLocaleString('en-IN')} saved`

  return {
    ruleId: bestRule.ruleId,
    subtotal,
    discountAmount,
    finalCartTotal,
    minCartValue: bestRule.minCartValue ?? null,
    label,
  }
}
