/**
 * api/parse-rule.js
 *
 * Vercel Serverless Function proxy for Gemini NL discount rule parsing.
 * Keeps API keys secure on the server while supporting temperature: 0
 * and JSON structured output schema.
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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).json({ error: 'Method Not Allowed. Use POST.' })
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return res.status(500).json({
      error: 'GEMINI_API_KEY environment variable is not configured on the server.',
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

  const input = body?.input
  if (!input || typeof input !== 'string' || input.trim() === '') {
    return res.status(400).json({ error: 'Missing or empty "input" field.' })
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${apiKey}`
    const payload = {
      contents: [
        {
          role: 'user',
          parts: [{ text: input.trim() }],
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
      return res.status(response.status).json({
        error: `Gemini API error (${response.status}): ${errText}`,
      })
    }

    const data = await response.json()
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text
    if (!rawText) {
      return res.status(502).json({ error: 'No content received from Gemini API.' })
    }

    let parsed
    try {
      parsed = JSON.parse(rawText)
    } catch {
      return res.status(502).json({ error: 'Model output was not valid JSON.', raw: rawText })
    }

    return res.status(200).json(parsed)
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal server error while parsing rule.' })
  }
}
