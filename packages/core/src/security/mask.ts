/**
 * Mask an API key for display. The renderer only ever sees this masked form —
 * the plaintext key never leaves the main process (§ security rule 1).
 */
export function maskApiKey(key: string): string {
  const trimmed = key.trim()
  if (trimmed.length <= 8) return 'sk-***'
  return `${trimmed.slice(0, 3)}***${trimmed.slice(-4)}`
}
