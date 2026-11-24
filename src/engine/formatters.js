/**
 * formatters.js
 *
 * Centralised currency formatting helper.
 * Formats numbers into standard Indian Rupee notation (e.g., 1104 => "Rs.1,104").
 * Avoids any accidental "$" in JSX text rendering.
 */

export function formatRupees(n) {
  if (n === null || n === undefined) return 'Rs.0'
  const num = typeof n === 'number' ? n : Number(n)
  if (isNaN(num)) return 'Rs.0'
  return `Rs.${num.toLocaleString('en-IN')}`
}
