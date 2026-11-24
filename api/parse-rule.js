/**
 * api/parse-rule.js
 *
 * Vercel Serverless Function proxy for Gemini NL discount rule parsing.
 * Single source of truth for the system prompt.
 * Keeps API keys and model parameters strictly on the server.
 */

export const SYSTEM_PROMPT = `You are a strict discount rule parsing engine for an e-commerce platform.
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

const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite'
const MAX_INPUT_LENGTH = 300
const TIMEOUT_MS = 15000

/**
 * Server-side re-validation of model-generated rule object.
 */
function validateServerRule(raw) {
  if (!raw || typeof raw !== 'object') {
    return 'Rule object is missing or not a JSON object.'
  }
  const scope = typeof raw.scope === 'string' ? raw.scope.trim().toLowerCase() : ''
  if (!['brand', 'platform', 'cart'].includes(scope)) {
    return `Scope must be "brand", "platform", or "cart", got "${raw.scope}".`
  }
  const type = typeof raw.type === 'string' ? raw.type.trim().toLowerCase() : ''
  if (!['percentage', 'flat'].includes(type)) {
    return `Type must be "percentage" or "flat", got "${raw.type}".`
  }
  const value = Number(raw.value)
  if (isNaN(value) || value <= 0) {
    return `Discount value must be a positive number, got "${raw.value}".`
  }
  if (type === 'percentage' && value > 100) {
    return `Percentage discount cannot exceed 100%, got "${value}%".`
  }
  let appliesTo = typeof raw.appliesTo === 'string' ? raw.appliesTo.trim() : ''
  if (scope === 'cart') {
    if (!appliesTo) appliesTo = 'Entire cart'
  } else if (!appliesTo) {
    return `${scope === 'brand' ? 'Brand' : 'Platform'} rules require a valid appliesTo target.`
  }
  let minCartValue = null
  if (scope === 'cart') {
    const minVal = Number(raw.minCartValue)
    if (isNaN(minVal) || minVal <= 0) {
      return 'Cart rules require a positive minCartValue threshold.'
    }
    minCartValue = minVal
  }

  return {
    scope,
    appliesTo,
    type,
    value,
    stackable: Boolean(raw.stackable),
    minCartValue,
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).json({ error: 'Method Not Allowed. Use POST.' })
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return res.status(500).json({
      error: 'GEMINI_API_KEY is not configured on the server. Please set it in your environment.',
    })
  }

  let body = req.body
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body)
    } catch {
      return res.status(400).json({ error: 'Invalid JSON request body.' })
    }
  }

  const rawInput = body?.input
  if (!rawInput || typeof rawInput !== 'string' || !rawInput.trim()) {
    return res.status(400).json({ error: 'Missing or empty "input" field.' })
  }

  const input = rawInput.trim()
  if (input.length > MAX_INPUT_LENGTH) {
    return res.status(400).json({
      error: `Input is too long (maximum ${MAX_INPUT_LENGTH} characters). Please provide a concise description.`,
    })
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`
    const payload = {
      contents: [
        {
          role: 'user',
          parts: [{ text: input }],
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
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (response.status === 429) {
      return res.status(429).json({
        error: 'Rate limit exceeded from Gemini API. Please wait a moment and try again.',
      })
    }

    if (!response.ok) {
      return res.status(502).json({
        error: `Upstream Gemini service returned status ${response.status}. Please try again later.`,
      })
    }

    const data = await response.json()
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text
    if (!rawText) {
      return res.status(502).json({ error: 'No content received from Gemini model.' })
    }

    // Defensively strip markdown formatting before JSON parse
    let cleanText = rawText.trim()
    if (cleanText.startsWith('```')) {
      cleanText = cleanText
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim()
    }

    let parsed
    try {
      parsed = JSON.parse(cleanText)
    } catch {
      return res.status(502).json({ error: 'Model output was not valid JSON.' })
    }

    // Validate LLM response shape
    if (typeof parsed !== 'object' || parsed === null || typeof parsed.resolvable !== 'boolean') {
      return res.status(502).json({ error: 'Model response did not conform to the expected schema.' })
    }

    if (!parsed.resolvable) {
      return res.status(200).json({
        resolvable: false,
        reason: parsed.reason || 'Rule description is ambiguous or missing required parameters.',
      })
    }

    // Re-validate rule object server-side
    const validatedRule = validateServerRule(parsed.rule)
    if (typeof validatedRule === 'string') {
      return res.status(502).json({
        error: `Model generated invalid rule parameters: ${validatedRule}`,
      })
    }

    return res.status(200).json({
      resolvable: true,
      rule: validatedRule,
    })
  } catch (err) {
    clearTimeout(timeoutId)
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'Gemini request timed out after 15 seconds. Please try again.' })
    }
    return res.status(500).json({ error: err.message || 'Internal error while processing discount rule.' })
  }
}
