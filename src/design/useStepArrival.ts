import { useLayoutEffect, useRef } from 'react'
import { animate } from 'motion/react'
import { calm, motionAllowed } from './motion'

/**
 * Steps that follow one another (a guest's booking: treatment, time, details, a final look). Each
 * new step arrives with a short drift from the side it comes from, forwards from the right and
 * back from the left, so a guest feels the journey move on. The first step simply appears.
 * Returns the ref for the element that holds the step.
 */
export function useStepArrival<T extends HTMLElement>(step: number) {
  const holder = useRef<T | null>(null)
  const last = useRef(step)
  useLayoutEffect(() => {
    const was = last.current
    last.current = step
    const element = holder.current
    if (was === step || !element || !motionAllowed()) return
    const from = step > was ? 18 : -18
    // In place before the screen is drawn, then home; nothing is left on the element afterwards.
    element.style.opacity = '0'
    element.style.transform = `translateX(${from}px)`
    const clear = () => {
      element.style.opacity = ''
      element.style.transform = ''
    }
    animate(
      element,
      { opacity: [0, 1], transform: [`translateX(${from}px)`, 'translateX(0px)'] },
      calm,
    ).then(clear, clear)
  }, [step])
  return holder
}
