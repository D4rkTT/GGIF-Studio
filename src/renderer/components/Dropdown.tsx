import React, { useCallback, useEffect, useRef, useState } from 'react'

interface DropdownOption {
  value: string
  label: string
}

interface DropdownProps {
  value: string
  options: DropdownOption[]
  onChange(v: string): void
}

/** Custom select with an animated popover menu. No native <select>. */
export function Dropdown({ value, options, onChange }: DropdownProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const selectedIndex = Math.max(0, options.findIndex((o) => o.value === value))
  const [active, setActive] = useState(selectedIndex)
  const current = options[selectedIndex]

  const close = useCallback((): void => setOpen(false), [])

  useEffect(() => {
    if (!open) return
    setActive(selectedIndex)
    const onDocDown = (e: MouseEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) close()
    }
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('mousedown', onDocDown)
    window.addEventListener('keydown', onEsc)
    return () => {
      window.removeEventListener('mousedown', onDocDown)
      window.removeEventListener('keydown', onEsc)
    }
  }, [open, close, selectedIndex])

  const choose = useCallback(
    (v: string): void => {
      onChange(v)
      setOpen(false)
    },
    [onChange]
  )

  const onTriggerKey = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>): void => {
      if (!open) {
        if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          setOpen(true)
        }
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActive((a) => (a + 1) % options.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActive((a) => (a - 1 + options.length) % options.length)
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        choose(options[active].value)
      }
    },
    [open, options, active, choose]
  )

  return (
    <div ref={rootRef} className={`dropdown ${open ? 'is-open' : ''}`}>
      <button
        type="button"
        className="dropdown__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onTriggerKey}
      >
        <span className="dropdown__value">{current?.label ?? ''}</span>
        <svg
          className="dropdown__chevron"
          width="12"
          height="12"
          viewBox="0 0 12 12"
          aria-hidden
        >
          <path
            d="M3 4.5L6 7.5L9 4.5"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      </button>

      {open && (
        <div className="dropdown__menu" role="listbox" tabIndex={-1}>
          {options.map((opt, i) => {
            const isSel = opt.value === value
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isSel}
                className={`dropdown__item ${isSel ? 'is-selected' : ''} ${
                  i === active ? 'is-active' : ''
                }`}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(opt.value)}
              >
                <span className="dropdown__check" aria-hidden>
                  {isSel && (
                    <svg width="12" height="12" viewBox="0 0 12 12">
                      <path
                        d="M2.5 6.2L5 8.5L9.5 3.5"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        fill="none"
                      />
                    </svg>
                  )}
                </span>
                <span className="dropdown__item-label">{opt.label}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
