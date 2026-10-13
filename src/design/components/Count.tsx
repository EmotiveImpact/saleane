/**
 * A small count beside a tab or a heading, such as Today's "10 to come" or "5 waiting". The number
 * always shows; what it counts is written beside it (`shown`) or read out only, where the tab's
 * own label already says it. It turns rose, as the sidebar's counts do, only when `attention` is
 * set and something is waiting on someone.
 */
export function Count({
  n,
  words,
  shown = false,
  attention = false,
}: {
  n: number
  /** What is counted, in words: "to come", "waiting", "professionals". */
  words: string
  /** Write the words beside the number, as a heading does. A tab keeps them for screen readers. */
  shown?: boolean
  attention?: boolean
}) {
  return (
    <span className="count" data-attention={attention && n > 0 ? '' : undefined}>
      {shown ? (
        `${n} ${words}`
      ) : (
        <>
          {n} <span className="sr-only">{words}</span>
        </>
      )}
    </span>
  )
}
