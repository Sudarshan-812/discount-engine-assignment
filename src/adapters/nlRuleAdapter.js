/**
 * nlRuleAdapter.js
 *
 * Adapter for Natural Language discount rule parsing.
 * Completely decoupled from discountEngine.js.
 *
 * Features:
 * - Calls /api/parse-rule (Vercel Serverless Function proxy)
 * - Automatically falls back to direct Gemini API call via VITE_GEMINI_API_KEY
 *   if /api/parse-rule returns 404 (when running plain `npm run dev` locally)
 * - Strict schema validation on the LLM output
 */

const SYSTEM_PROMPT = `You are a strict discount rule parsing engine for an e-commerce platform.
Your task is to convert natural language descriptions of discount rules into a structured JSON rule object, or reject them if ambiguous or missing details.

Output Requirements:
Return strictly a single JSON object. No markdown wrappers, no code blocks (do not use \`\`\`json).

Output Format (ONE of the following two):

If the rule is clear and contains all required parameters:
{
  "resolvable": true,
  "rule": {
    "scope": "brand" | "platform" | "cart",
    "appliesTo": string,
    "type": "percentage" | "flat",
    "value": number,
    "stackable": boolean,
    "minCartValue": number | null
  }
}

If the rule is ambiguous, incomplete, or missing critical parameters:
{
  "resolvable": false,
  "reason": "Clear explanation of what is missing (e.g. missing discount amount, brand/platform name, or cart threshold)"
}

Rules & Constraints:
1. "scope" must be:
   - "brand": discount applies to a specific brand (e.g. "Natura Casa", "LivSpace Pro"). "appliesTo" must be the brand name. "minCartValue" must be null.
   - "platform": discount applies to a specific platform (e.g. "Amazon India", "Flipkart", "Noon"). "appliesTo" must be the platform name. "minCartValue" must be null.
   - "cart": discount applies to the entire cart when a minimum spend is reached (e.g. "orders over Rs.4,000 get 10% off"). "appliesTo" must be "Entire cart". "minCartValue" must be a positive number representing the minimum spend threshold. If no threshold is specified, it is ambiguous.
2. "type" must be:
   - "percentage" (for % off; "value" is a positive number between 1 and 100).
   - "flat" (for fixed currency discount like Rs. 150 off; "value" is a positive number).
3. "stackable":
   - boolean. Set to true ONLY if explicitly mentioned that it can stack or combine with other offers. Default to false.
4. Ambiguity / Never Guess:
   - NEVER invent or assume missing numbers, missing platforms, missing brands, or missing cart thresholds.
   - For vague phrases like "Give a discount for big orders", "Special offer on Flipkart", or "Discount for everyone", return resolvable: false with a concise, helpful reason.`

/**
 * Validates a parsed rule object against strict business logic rules.
 * Returns { ok: true, rule } or { ok: false, error: string }.
 */
export function validateParsedRule(rawRule) {
  if (!rawRule || typeof rawRule !== 'object') {
    return { ok: false, error: 'Rule object is missing or invalid.' }
  }

  const scope = typeof rawRule.scope === 'string' ? rawRule.scope.trim().toLowerCase() : ''
  if (scope !== 'brand' && scope !== 'platform' && scope !== 'cart') {
    return {
      ok: false,
      error: `Invalid scope "${rawRule.scope}". Must be "brand", "platform", or "cart".`,
    }
  }

  const type = typeof rawRule.type === 'string' ? rawRule.type.trim().toLowerCase() : ''
  if (type !== 'percentage' && type !== 'flat') {
    return {
      ok: false,
      error: `Invalid discount type "${rawRule.type}". Must be "percentage" or "flat".`,
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
  } else {
    if (!appliesTo) {
      return {
        ok: false,
        error: `${scope === 'brand' ? 'Brand' : 'Platform'} rules require a valid target name.`,
      }
    }
  }

  let minCartValue = null
  if (scope === 'cart') {
    const minVal = Number(rawRule.minCartValue)
    if (isNaN(minVal) || minVal <= 0) {
      return {
        ok: false,
        error: 'Cart rules require a positive minimum cart value threshold (e.g. 4000).',
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
 * Direct browser fallback to Gemini API when running plain `npm run dev` locally.
 */
async function callGeminiDirectly(inputText, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${apiKey}`
  const payload = {
    contents: [
      {
        role: 'user',
        parts: [{ text: inputText }],
      },
    ],
    systemInstruction: {
      parts: [{ text: SYSTEM_PROMPT }],
    },
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
    },
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`Gemini API error (${response.status}): ${errText}`)
  }

  const data = await response.json()
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text
  if (!rawText) {
    throw new Error('No content returned from Gemini model.')
  }

  return JSON.parse(rawText)
}

/**
 * Parses natural language input into a structured DiscountRule.
 * Returns Promise<{ ok: true, rule: DiscountRule } | { ok: false, error: string }>
 */
export async function parseNaturalLanguageRule(inputText) {
  if (!inputText || typeof inputText !== 'string' || !inputText.trim()) {
    return { ok: false, error: 'Please enter a description for the discount rule.' }
  }

  const trimmed = inputText.trim()
  let responseData = null

  // 1. Try calling the Vercel Serverless Function proxy first
  try {
    const res = await fetch('/api/parse-rule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: trimmed }),
    })

    if (res.status === 404) {
      // Running under plain `npm run dev` without Vercel serverless functions
      const localKey = import.meta.env.VITE_GEMINI_API_KEY
      if (!localKey) {
        return {
          ok: false,
          error:
            '/api/parse-rule returned 404 and VITE_GEMINI_API_KEY is not set. Add VITE_GEMINI_API_KEY to your .env.local for local Vite dev.',
        }
      }
      responseData = await callGeminiDirectly(trimmed, localKey)
    } else if (!res.ok) {
      const errJson = await res.json().catch(() => null)
      return {
        ok: false,
        error: errJson?.error || `Server error (${res.status}) while parsing rule.`,
      }
    } else {
      responseData = await res.json()
    }
  } catch (err) {
    // If network error occurred, try fallback if local key is available
    const localKey = import.meta.env.VITE_GEMINI_API_KEY
    if (localKey) {
      try {
        responseData = await callGeminiDirectly(trimmed, localKey)
      } catch (directErr) {
        return { ok: false, error: directErr.message || 'Failed to parse rule.' }
      }
    } else {
      return { ok: false, error: err.message || 'Failed to connect to rule parser.' }
    }
  }

  if (!responseData) {
    return { ok: false, error: 'No response received from rule parser.' }
  }

  // Handle resolvable: false
  if (responseData.resolvable === false) {
    return {
      ok: false,
      error: responseData.reason || 'Input rule is ambiguous or missing required parameters.',
    }
  }

  // Handle resolvable: true -> validate rule
  return validateParsedRule(responseData.rule)
}
