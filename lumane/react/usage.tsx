import type { HTMLAttributes } from 'react'

/** One kind of use on the usage line, such as typed questions or talking time. */
export type UsageItem = {
  used: number
  allowance: number
  /** Counted in uses, or in seconds and shown in whole minutes. */
  unit: 'uses' | 'seconds'
  /** What is counted, in the plural, such as "questions" or "talking minutes". */
  noun: string
}

/**
 * The usage line in words: "3 of 300 questions used this month. 4 of 30 talking minutes used."
 * Talking time shows the minutes started against the whole minutes included.
 */
export function usageLine(
  items: UsageItem[],
  { period, locale = 'en-GB' }: { period?: string; locale?: string } = {},
) {
  const figure = (n: number) => n.toLocaleString(locale)
  return items
    .map((item, i) => {
      const [used, allowance] =
        item.unit === 'seconds'
          ? [Math.ceil(item.used / 60), Math.floor(item.allowance / 60)]
          : [item.used, item.allowance]
      const when = i === 0 && period ? ` ${period}` : ''
      return `${figure(used)} of ${figure(allowance)} ${item.noun} used${when}.`
    })
    .join(' ')
}

/** Whether any kind of use is running out: from four fifths used it is near, then reached. */
export function usageState(items: UsageItem[]): 'fine' | 'near' | 'reached' {
  if (items.some((item) => item.used >= item.allowance)) return 'reached'
  if (items.some((item) => item.used >= item.allowance * 0.8)) return 'near'
  return 'fine'
}

/** How much of the allowance has been used. An app can say it in its own words as children. */
export function UsageLine({
  items,
  period = 'this month',
  locale,
  children,
  ...props
}: HTMLAttributes<HTMLParagraphElement> & {
  items: UsageItem[]
  period?: string
  locale?: string
}) {
  return (
    <p {...props} data-lumane="usage" data-state={usageState(items)}>
      {children ?? usageLine(items, { period, locale })}
    </p>
  )
}
