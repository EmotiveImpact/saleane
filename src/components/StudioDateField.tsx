import type { ComponentProps } from 'react'
import { useStore } from '../state/context'
import { DateField } from '../design'

/** The design DateField in the studio's own locale, with the studio's today marked. */
export function StudioDateField(props: Omit<ComponentProps<typeof DateField>, 'locale' | 'today'>) {
  const { state, today } = useStore()
  return <DateField locale={state.organisation.locale} today={today} {...props} />
}
