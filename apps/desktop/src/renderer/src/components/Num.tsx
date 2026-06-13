interface NumProps {
  value: number
  minimumFractionDigits?: number
  maximumFractionDigits?: number
  prefix?: string
  suffix?: string
  className?: string
}

/**
 * Tabular-figures number. Use everywhere a number is shown so columns align and
 * values don't jitter as they change (ledger aesthetic, rule 1).
 */
export function Num({
  value,
  minimumFractionDigits,
  maximumFractionDigits,
  prefix,
  suffix,
  className,
}: NumProps): JSX.Element {
  const formatted = value.toLocaleString(undefined, {
    minimumFractionDigits,
    maximumFractionDigits,
  })
  return (
    <span className={className ? `tnum ${className}` : 'tnum'}>
      {prefix}
      {formatted}
      {suffix}
    </span>
  )
}
