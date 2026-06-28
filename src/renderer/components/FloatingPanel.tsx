import React, { useCallback, useRef, useState } from 'react'

interface FloatingPanelProps {
  title: string
  initial: { x: number; y: number }
  onClose(): void
  children: React.ReactNode
}

/**
 * A draggable, closeable floating window. The header is the drag handle
 * (pointer-capture based, clamped within the viewport). The body keeps
 * `overflow: visible` so Dropdown popovers are never clipped. Position is
 * held in internal state, seeded once from `initial`.
 */
export function FloatingPanel({
  title,
  initial,
  onClose,
  children
}: FloatingPanelProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number }>(initial)
  const drag = useRef<{ dx: number; dy: number } | null>(null)

  const clampPos = useCallback((x: number, y: number): { x: number; y: number } => {
    const el = ref.current
    const w = el?.offsetWidth ?? 280
    const maxX = Math.max(0, window.innerWidth - w)
    // Keep at least the header within reach so the panel can never be lost.
    const maxY = Math.max(0, window.innerHeight - 40)
    return {
      x: Math.min(Math.max(0, x), maxX),
      y: Math.min(Math.max(0, y), maxY)
    }
  }, [])

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>): void => {
    if ((e.target as HTMLElement).closest('.fp-close')) return
    e.preventDefault()
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    drag.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }, [])

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      const d = drag.current
      if (!d) return
      setPos(clampPos(e.clientX - d.dx, e.clientY - d.dy))
    },
    [clampPos]
  )

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>): void => {
    drag.current = null
    ;(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId)
  }, [])

  return (
    <div
      ref={ref}
      className="fp-panel"
      style={{ left: pos.x, top: pos.y }}
      role="dialog"
      aria-label={title}
    >
      <div
        className="fp-header"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <span className="fp-title">{title}</span>
        <button type="button" className="fp-close" onClick={onClose} aria-label="Close panel">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
            <path
              d="M3.5 3.5L10.5 10.5M10.5 3.5L3.5 10.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
      <div className="fp-body">{children}</div>
    </div>
  )
}
