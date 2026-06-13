/** Cursor-tracking CSS vars for the .spotlight hover effect (idea:
 *  React Bits SpotlightCard — original implementation). */
export function spotlightMove(e: React.MouseEvent<HTMLElement>): void {
  const r = e.currentTarget.getBoundingClientRect()
  e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`)
  e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`)
}
