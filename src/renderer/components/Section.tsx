import React, { useCallback, useEffect, useRef, useState } from 'react'

interface SectionProps {
  title: string
  icon?: string
  defaultOpen?: boolean
  children: React.ReactNode
}

/** Collapsible inspector group with animated height. */
export function Section({
  title,
  icon,
  defaultOpen = true,
  children
}: SectionProps): JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number | undefined>(defaultOpen ? undefined : 0)

  // Measure content so the height transition has a concrete target, then release
  // to `auto` (undefined) once expanded so nested content can grow freely.
  const sync = useCallback((): (() => void) | undefined => {
    const el = bodyRef.current
    if (!el) return undefined
    if (open) {
      setHeight(el.scrollHeight)
      const id = window.setTimeout(() => setHeight(undefined), 240)
      return () => window.clearTimeout(id)
    }
    // Lock current height first, then collapse on the next frame.
    setHeight(el.scrollHeight)
    const raf = requestAnimationFrame(() => setHeight(0))
    return () => cancelAnimationFrame(raf)
  }, [open])

  useEffect(() => {
    return sync()
  }, [sync, children])

  return (
    <div className={`section ${open ? 'is-open' : ''}`}>
      <button
        type="button"
        className="section__header"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {icon && (
          <span className="section__icon" aria-hidden>
            {icon}
          </span>
        )}
        <span className="section__title">{title}</span>
        <svg
          className="section__chevron"
          width="12"
          height="12"
          viewBox="0 0 12 12"
          aria-hidden
        >
          <path
            d="M4.5 3L7.5 6L4.5 9"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      </button>
      <div
        className="section__body"
        style={{ height: height === undefined ? 'auto' : height }}
        aria-hidden={!open}
      >
        <div ref={bodyRef} className="section__content">
          {children}
        </div>
      </div>
    </div>
  )
}
