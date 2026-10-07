import type { ReactNode } from 'react'
import * as RadixTabs from '@radix-ui/react-tabs'

/**
 * Sections of one workspace that replace each other in place. Radix Tabs
 * supplies the tablist semantics, roving focus and panel labelling. The
 * panel renders only the active section, so callers pass its content as
 * children rather than one panel per tab.
 */
export function Tabs<T extends string>({
  label,
  value,
  onChange,
  tabs,
  disabled = false,
  orientation = 'horizontal',
  children,
}: {
  label: string
  value: T
  onChange: (value: T) => void
  tabs: { value: T; label: ReactNode }[]
  disabled?: boolean
  /** Vertical lists sit beside the panel, as on the Settings page. */
  orientation?: 'horizontal' | 'vertical'
  children: ReactNode
}) {
  return (
    <RadixTabs.Root
      className={`tabs tabs-${orientation}`}
      orientation={orientation}
      value={value}
      onValueChange={(next) => onChange(next as T)}
    >
      <RadixTabs.List className="tabs-list" aria-label={label}>
        {tabs.map((tab) => (
          <RadixTabs.Trigger
            key={tab.value}
            value={tab.value}
            disabled={disabled}
            className="tabs-trigger"
          >
            {tab.label}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      <RadixTabs.Content value={value} className="tabs-panel">
        {children}
      </RadixTabs.Content>
    </RadixTabs.Root>
  )
}
