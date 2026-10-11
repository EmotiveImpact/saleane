import type { ReactNode } from 'react'
import { MotionConfig } from 'motion/react'
import { calm, useMotionAllowed } from '../motion'

/**
 * Wraps the app once. Every Motion animation inside takes the calm timing unless it says
 * otherwise, and none runs when motion is not allowed.
 */
export function CalmMotion({ children }: { children: ReactNode }) {
  const allowed = useMotionAllowed()
  return (
    <MotionConfig
      transition={allowed ? calm : { duration: 0 }}
      reducedMotion={allowed ? 'never' : 'always'}
    >
      {children}
    </MotionConfig>
  )
}
