import { Children, isValidElement, useId } from 'react'
import type { CSSProperties, ReactElement, ReactNode } from 'react'
import { Select as RadixSelect } from 'radix-ui'
import { Check, ChevronDown } from 'lucide-react'

type Option = { value: string; label: ReactNode; disabled?: boolean }
type Group = { label?: string; options: Option[] }

/** Radix keeps the empty value for "nothing chosen", so an option worth "" travels as this. */
const EMPTY = '⁠empty'
const toRadix = (value: string) => (value === '' ? EMPTY : value)
const fromRadix = (value: string) => (value === EMPTY ? '' : value)

type OptionProps = { value?: string | number; children?: ReactNode; disabled?: boolean }
type GroupProps = { label?: string; children?: ReactNode }

/** Reads `<option>` and `<optgroup>` children, so a select moves across without being rewritten. */
function read(children: ReactNode): Group[] {
  const groups: Group[] = []
  let loose: Group | null = null
  const option = (element: ReactElement<OptionProps>): Option => ({
    value: String(element.props.value ?? textOf(element.props.children)),
    label: element.props.children,
    disabled: element.props.disabled,
  })
  for (const child of Children.toArray(children)) {
    if (!isValidElement(child)) continue
    if (child.type === 'optgroup') {
      loose = null
      const props = child.props as GroupProps
      groups.push({
        label: props.label,
        options: Children.toArray(props.children)
          .filter(isValidElement)
          .map((o) => option(o as ReactElement<OptionProps>)),
      })
    } else if (child.type === 'option') {
      if (!loose) groups.push((loose = { options: [] }))
      loose.options.push(option(child as ReactElement<OptionProps>))
    }
  }
  return groups
}

function textOf(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children)
  return ''
}

/** What the old `<select>`'s change handler read, so handlers move across as they are. */
type Change = { target: { value: string; name?: string }; currentTarget: { value: string } }

/**
 * A choice from a list, drawn in SALEANE's own fields and colours on every phone and computer.
 * Built on Radix Select: arrow keys and typing move through it, Escape closes it, and screen
 * readers hear a combobox with its label. Write it as a `<select>` would be written, with
 * `<option>` and `<optgroup>` children; `onChange` receives `{ target: { value } }`.
 */
export function Select({
  value,
  defaultValue,
  onChange,
  onValueChange,
  children,
  id,
  name,
  disabled,
  required,
  className = '',
  style,
  placeholder,
  ...aria
}: {
  value?: string | number
  defaultValue?: string | number
  onChange?: (event: Change) => void
  onValueChange?: (value: string) => void
  children: ReactNode
  id?: string
  name?: string
  disabled?: boolean
  required?: boolean
  className?: string
  style?: CSSProperties
  /** Shown when nothing is chosen and no option is worth "". */
  placeholder?: string
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean | 'true' | 'false'
  autoFocus?: boolean
}) {
  const groups = read(children)
  const fallback = useId()
  const all = groups.flatMap((group) => group.options)
  const current = value === undefined ? undefined : toRadix(String(value ?? ''))
  // Like a native select, an unknown value shows the first option rather than nothing.
  const shown =
    current !== undefined && all.some((o) => toRadix(o.value) === current)
      ? current
      : current !== undefined && all.length
        ? toRadix(all[0].value)
        : current
  return (
    <RadixSelect.Root
      value={shown}
      defaultValue={defaultValue === undefined ? undefined : toRadix(String(defaultValue))}
      onValueChange={(next) => {
        const chosen = fromRadix(next)
        onValueChange?.(chosen)
        onChange?.({ target: { value: chosen, name }, currentTarget: { value: chosen } })
      }}
      name={name}
      disabled={disabled}
      required={required}
    >
      <RadixSelect.Trigger
        id={id ?? fallback}
        className={`select-trigger ${className}`}
        style={style}
        {...aria}
      >
        <RadixSelect.Value placeholder={placeholder} />
        <RadixSelect.Icon className="select-icon">
          <ChevronDown size={16} aria-hidden="true" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          className="select-content"
          position="popper"
          sideOffset={6}
          collisionPadding={12}
        >
          <RadixSelect.Viewport className="select-viewport">
            {groups.map((group, i) => (
              <RadixSelect.Group key={group.label ?? `group-${i}`}>
                {group.label && (
                  <RadixSelect.Label className="select-label">{group.label}</RadixSelect.Label>
                )}
                {group.options.map((option) => (
                  <RadixSelect.Item
                    key={option.value}
                    value={toRadix(option.value)}
                    disabled={option.disabled}
                    className="select-item"
                    data-value={option.value}
                  >
                    <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                    <RadixSelect.ItemIndicator className="select-tick">
                      <Check size={16} aria-hidden="true" />
                    </RadixSelect.ItemIndicator>
                  </RadixSelect.Item>
                ))}
              </RadixSelect.Group>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  )
}
