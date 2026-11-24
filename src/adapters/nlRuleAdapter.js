/**
 * nlRuleAdapter.js
 *
 * Client-side adapter for Natural Language discount rule parsing.
 * Completely decoupled from discountEngine.js.
 *
 * Architecture:
 * - Browser adapter does NOT contain Gemini API keys, system prompts, or direct LLM calls.
 * - Proxies requests to /api/parse-rule (Vercel Serverless Function in prod, Vite dev plugin locally).
 * - Enforces strict client-side validation via `validateParsedRule`.
 */

/**
 * Validates a parsed rule object against strict business logic rules.
 *
 * @param {object} rawRule
 * @returns {{ ok: true, rule: object } | { ok: false, error: string }}
 */
export function validateParsedRule(rawRule) {
  if (!rawRule || typeof rawRule !== 'object') {
    return { ok: false, error: 'Rule object is missing or invalid.' }
  }

  const scope = typeof rawRule.scope === 'string' ? rawRule.scope.trim().toLowerCase() : ''
  if (scope !== 'brand' && scope !== 'platform' && scope !== 'cart') {
    return {
      ok: false,
      error: `Unknown scope "${rawRule.scope}". Must be "brand", "platform", or "cart".`,
    }
  }

  const type = typeof rawRule.type === 'string' ? rawRule.type.trim().toLowerCase() : ''
  if (type !== 'percentage' && type !== 'flat') {
    return {
      ok: false,
      error: `Unknown discount type "${rawRule.type}". Must be "percentage" or "flat".`,
    }
  }

  const value = Number(rawRule.value)
  if (isNaN(value) || value <= 0) {
    return {
      ok: false,
      error: `Discount value must be a positive number, got "${rawRule.value}".`,
    }
  }

  if (type === 'percentage' && value > 100) {
    return {
      ok: false,
      error: `Percentage discount cannot exceed 100%, got "${value}%".`,
    }
  }

  let appliesTo = typeof rawRule.appliesTo === 'string' ? rawRule.appliesTo.trim() : ''
  if (scope === 'cart') {
    if (!appliesTo) {
      appliesTo = 'Entire cart'
    }
  } else if (!appliesTo) {
    return {
      ok: false,
      error: `${scope === 'brand' ? 'Brand' : 'Platform'} rules require a valid target name.`,
    }
  }

  let minCartValue = null
  if (scope === 'cart') {
    const minVal = Number(rawRule.minCartValue)
    if (isNaN(minVal) || minVal <= 0) {
      return {
        ok: false,
        error: 'Cart rules require a positive minimum cart value threshold.',
      }
    }
    minCartValue = minVal
  }

  const stackable = Boolean(rawRule.stackable)

  return {
    ok: true,
    rule: {
      scope,
      appliesTo,
      type,
      value,
      stackable,
      minCartValue,
    },
  }
}

/**
 * Sends a natural language rule description to the server-side proxy.
 *
 * @param {string} inputText
 * @returns {Promise<{ ok: true, rule: object } | { ok: false, error: string }>}
 */
export async function parseNaturalLanguageRule(inputText) {
  if (!inputText || typeof inputText !== 'string' || !inputText.trim()) {
    return { ok: false, error: 'Please enter a description for the discount rule.' }
  }

  const trimmed = inputText.trim()
  let response

  try {
    response = await fetch('/api/parse-rule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: trimmed }),
    })
  } catch (netErr) {
    return {
      ok: false,
      error: 'Network failure: unable to connect to the rule parsing service. Please check your connection.',
    }
  }

  let responseData
  try {
    responseData = await response.json()
  } catch {
    return {
      ok: false,
      error: `Server returned a non-JSON response (HTTP status ${response.status}).`,
    }
  }

  if (!response.ok) {
    return {
      ok: false,
      error: responseData?.error || `Server error (${response.status}) while parsing rule.`,
    }
  }

  if (responseData.resolvable === false) {
    return {
      ok: false,
      error: responseData.reason || 'Rule description is ambiguous or missing required parameters.',
    }
  }

  return validateParsedRule(responseData.rule)
}
