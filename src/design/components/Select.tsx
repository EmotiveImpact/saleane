import { Children, Fragment, isValidElement, useEffect, useId, useRef, useState } from 'react'
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
  const visit = (nodes: ReactNode) => {
    for (const child of Children.toArray(nodes)) {
      if (!isValidElement(child)) continue
      // Options are often grouped in a fragment, such as a heading choice and then a list.
      if (child.type === Fragment) visit((child.props as { children?: ReactNode }).children)
      else take(child)
    }
  }
  const take = (child: ReactElement) => {
    if (child.type === 'optgroup') {
      loose = null
      const props = child.props as GroupProps
      groups.push({
        label: props.label,
        options: flat(props.children).map((o) => option(o as ReactElement<OptionProps>)),
      })
    } else if (child.type === 'option') {
      if (!loose) groups.push((loose = { options: [] }))
      loose.options.push(option(child as ReactElement<OptionProps>))
    }
  }
  visit(children)
  return groups
}

/** The elements in a list of children, with fragments opened up. */
function flat(nodes: ReactNode): ReactElement[] {
  return Children.toArray(nodes).flatMap((child) =>
    !isValidElement(child)
      ? []
      : child.type === Fragment
        ? flat((child.props as { children?: ReactNode }).children)
        : [child],
  )
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
export type SelectProps = {
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
  title?: string
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean | 'true' | 'false'
  'aria-required'?: boolean | 'true' | 'false'
}

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
}: SelectProps) {
  const groups = read(children)
  const fallback = useId()
  const all = groups.flatMap((group) => group.options)
  // Without `value` the field keeps its own choice, starting from `defaultValue`.
  const [own, setOwn] = useState(defaultValue === undefined ? undefined : String(defaultValue))
  const asked = value === undefined ? own : String(value ?? '')
  // As a native select does: a value on the list is shown; nothing chosen shows the placeholder
  // when there is one; anything else shows, and stands for, the first option.
  const chosen =
    asked !== undefined && all.some((o) => o.value === asked)
      ? asked
      : placeholder !== undefined && !asked
        ? ''
        : (all[0]?.value ?? '')
  const listed = all.some((o) => o.value === chosen)
  return (
    <RadixSelect.Root
      value={listed ? toRadix(chosen) : ''}
      onValueChange={(next) => {
        const picked = fromRadix(next)
        if (value === undefined) setOwn(picked)
        onValueChange?.(picked)
        onChange?.({ target: { value: picked, name }, currentTarget: { value: picked } })
      }}
      disabled={disabled}
    >
      <RadixSelect.Trigger
        id={id ?? fallback}
        // The chosen value rides on the button too, as it would on a native select.
        value={chosen}
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
      {name !== undefined && (
        <FormValue name={name} value={chosen} required={required} disabled={disabled}>
          {all}
        </FormValue>
      )}
    </RadixSelect.Root>
  )
}

/**
 * What a form reads: a hidden native select holding the plain value, "" included, so FormData and
 * a form's own change handler see this field exactly as they saw the browser's select.
 */
function FormValue({
  name,
  value,
  required,
  disabled,
  children,
}: {
  name: string
  value: string
  required?: boolean
  disabled?: boolean
  children: Option[]
}) {
  const field = useRef<HTMLSelectElement>(null)
  const was = useRef(value)
  useEffect(() => {
    const select = field.current
    if (!select || was.current === value) return
    was.current = value
    // Tell the form, as the browser does when someone picks an option.
    select.dispatchEvent(new Event('change', { bubbles: true }))
  }, [value])
  return (
    <select
      ref={field}
      name={name}
      value={value}
      required={required}
      disabled={disabled}
      onChange={() => {}}
      aria-hidden="true"
      tabIndex={-1}
      className="select-form-value"
    >
      {!children.some((o) => o.value === value) && <option value={value} />}
      {children.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled} />
      ))}
    </select>
  )
}
