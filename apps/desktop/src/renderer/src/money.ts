/** Format a CNY amount as ¥. Costs are native RMB (DeepSeek bills in CNY). */
export function yuan(n: number, digits = 4): string {
  return '¥' + n.toFixed(digits)
}
