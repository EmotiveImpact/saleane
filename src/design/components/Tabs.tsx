import { useId } from 'react'
import type { ReactNode } from 'react'
import { Tabs as RadixTabs } from 'radix-ui'
import { ChosenMark } from './ChosenMark'
import { Select } from './Select'

type Tab<T extends string> = {
  value: T
  label: ReactNode
  /** The label in plain words, for the picker, when `label` holds more than words. */
  text?: string
}

/**
 * Sections of one workspace that replace each other in place. Radix Tabs
 * supplies the tablist semantics, roving focus and panel labelling. The
 * panel renders only the active section, so callers pass its content as
 * children rather than one panel per tab.
 *
 * A long vertical list can be split into named `groups`, each its own short
 * tablist under a quiet heading. With `picker`, narrow screens show one select,
 * with the same groups, in place of the list. The shape behind the chosen tab slides
 * to the next one, across groups too.
 */
export function Tabs<T extends string>({
  label,
  value,
  onChange,
  tabs = [],
  groups,
  picker,
  disabled = false,
  orientation = 'horizontal',
  find,
  empty,
  children,
}: {
  label: string
  value: T
  onChange: (value: T) => void
  tabs?: Tab<T>[]
  groups?: { label: string; tabs: Tab<T>[] }[]
  /** The label of the select that narrow screens show in place of the list. */
  picker?: string
  disabled?: boolean
  /** Vertical lists sit beside the panel, as on the Settings page. */
  orientation?: 'horizontal' | 'vertical'
  /** A field above grouped lists that narrows them, such as "Find a setting". */
  find?: ReactNode
  /** What the grouped lists say when the field has narrowed them to nothing. */
  empty?: ReactNode
  children: ReactNode
}) {
  const group = useId()
  const trigger = (tab: Tab<T>) => (
    <RadixTabs.Trigger
      key={tab.value}
      value={tab.value}
      disabled={disabled}
      className="tabs-trigger"
    >
      {tab.label}
      {tab.value === value && <ChosenMark group={group} radius={12} />}
    </RadixTabs.Trigger>
  )
  const words = (tab: Tab<T>) =>
    tab.text ?? (typeof tab.label === 'string' ? tab.label : String(tab.value))
  const option = (tab: Tab<T>) => (
    <option key={tab.value} value={tab.value}>
      {words(tab)}
    </option>
  )
  const classes = ['tabs', `tabs-${orientation}`, groups && 'tabs-grouped', picker && 'has-picker']
  return (
    <RadixTabs.Root
      className={classes.filter(Boolean).join(' ')}
      orientation={orientation}
      value={value}
      onValueChange={(next) => onChange(next as T)}
    >
      {groups ? (
        <div className="tabs-groups" role="group" aria-label={label}>
          {find}
          {groups.length === 0 && empty}
          {groups.map((group) => (
            <div className="tabs-group" key={group.label}>
              <p className="tabs-group-label" aria-hidden="true">
                {group.label}
              </p>
              <RadixTabs.List className="tabs-list" aria-label={group.label}>
                {group.tabs.map(trigger)}
              </RadixTabs.List>
            </div>
          ))}
        </div>
      ) : (
        <RadixTabs.List className="tabs-list" aria-label={label}>
          {tabs.map(trigger)}
        </RadixTabs.List>
      )}
      {picker && (
        <label className="tabs-picker">
          <span>{picker}</span>
          <Select
            value={value}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value as T)}
          >
            {groups
              ? groups.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.tabs.map(option)}
                  </optgroup>
                ))
              : tabs.map(option)}
          </Select>
        </label>
      )}
      <RadixTabs.Content value={value} className="tabs-panel">
        {children}
      </RadixTabs.Content>
    </RadixTabs.Root>
  )
}
