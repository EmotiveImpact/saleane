import { motion } from 'motion/react'
import { useMotionAllowed } from '../motion'

/**
 * The shape behind, or the line under, whatever is chosen in a row of choices: a tab, a period, a
 * calendar view. Every row draws it the same way, and with Motion it slides from the old choice to
 * the new one, so the eye follows the change. Rows give it their own `group` so two rows on one
 * page never trade marks. Where motion is not allowed it simply sits under the new choice.
 */
export function ChosenMark({
  group,
  radius,
  className = '',
}: {
  group: string
  /** Its corners in pixels, kept round while it stretches between choices of different widths. */
  radius?: number
  className?: string
}) {
  const moving = useMotionAllowed()
  const classes = `chosen-mark ${className}`
  return moving ? (
    <motion.span
      layoutId={group}
      className={classes}
      aria-hidden="true"
      style={radius === undefined ? undefined : { borderRadius: radius }}
    />
  ) : (
    <span className={classes} aria-hidden="true" />
  )
}
