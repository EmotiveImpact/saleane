/**
 * Stage 6: the money axis of a bar chart. The top line is a round figure in whole pounds or
 * dollars at or above the highest bar, and the middle line is exactly half of it, so neither ever
 * shows a part of a pound. With no takings at all there is nothing to scale, and the axis says
 * only zero rather than inventing a penny from rounding or a minimum.
 */

/** Minor units in one pound or dollar, the only currencies a studio can use. */
const UNIT = 100
/** Round tops, as multiples of a power of ten. Each halves to a whole number of pounds. */
const STEPS = [2, 4, 6, 8, 10]

export type ChartScale = {
  /** The top of the axis, in minor units, or 0 when nothing was taken. */
  top: number
  /** Half the top, in minor units: always whole pounds or dollars. */
  half: number
}

export function chartScale(values: number[]): ChartScale {
  const highest = Math.max(0, ...values.filter((v) => Number.isFinite(v)))
  if (highest <= 0) return { top: 0, half: 0 }
  const units = highest / UNIT
  let power = 1
  while (power * STEPS[STEPS.length - 1] < units) power *= 10
  const step = STEPS.find((s) => s * power >= units)!
  const top = step * power * UNIT
  return { top, half: top / 2 }
}

/** A bar's height as a share of the axis, from 0 to 100. */
export const barHeight = (value: number, scale: ChartScale) =>
  scale.top > 0 ? Math.min(100, Math.max(0, (value / scale.top) * 100)) : 0
