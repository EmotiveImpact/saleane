import { useEffect, useRef } from 'react'

/** Returns the ref for the step's heading; nothing moves on the first step shown. */
export function useWizardStep(step: number) {
  const heading = useRef<HTMLHeadingElement>(null)
  const shown = useRef(step)
  useEffect(() => {
    if (shown.current === step) return
    shown.current = step
    const dialog = heading.current?.closest('.dialog-content')
    if (dialog) dialog.scrollTop = 0
    heading.current?.focus({ preventScroll: true })
  }, [step])
  return heading
}
