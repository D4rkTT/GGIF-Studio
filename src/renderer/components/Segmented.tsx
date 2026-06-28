import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

interface SegmentedOption {
  value: string
  label: string
  icon?: string
}

interface SegmentedProps {
  value: string
  options: SegmentedOption[]
  onChange(v: string): void
}

interface IndicatorRect {
  left: number
  width: number
}

/**
 * Segmented control with a sliding indicator that animates between options.
 * Built on pointer events; keyboard arrows move the selection.
 */
export function Segmented({ value, options, onChange }: SegmentedProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [rect, setRect] = useState<IndicatorRect | null>(null)
  const activeIndex = Math.max(0, options.findIndex((o) => o.value === value))

  const measure = useCallback((): void => {
    const root = rootRef.current
    const el = itemRefs.current[activeIndex]
    if (!root || !el) return
    const rootBox = root.getBoundingClientRect()
    const box = el.getBoundingClientRect()
    setRect({ left: box.left - rootBox.left, width: box.width })
  }, [activeIndex])

  useLayoutEffect(measure, [measure, options.length])

  useEffect(() => {
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [measure])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>): void => {
      let next = activeIndex
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (activeIndex + 1) % options.length
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
        next = (activeIndex - 1 + options.length) % options.length
      else return
      e.preventDefault()
      onChange(options[next].value)
    },
    [activeIndex, options, onChange]
  )

  return (
    <div
      ref={rootRef}
      className="segmented"
      role="tablist"
      onKeyDown={onKeyDown}
    >
      {rect && (
        <span
          className="segmented__indicator"
          style={{ transform: `translateX(${rect.left}px)`, width: rect.width }}
          aria-hidden
        />
      )}
      {options.map((opt, i) => {
        const selected = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            ref={(el) => (itemRefs.current[i] = el)}
            className={`segmented__item ${selected ? 'is-active' : ''}`}
            onPointerDown={() => onChange(opt.value)}
          >
            {opt.icon && (
              <span className="segmented__icon" aria-hidden>
                {opt.icon}
              </span>
            )}
            <span className="segmented__text">{opt.label}</span>
          </button>
        )
      })}
    </div>
  )
}
