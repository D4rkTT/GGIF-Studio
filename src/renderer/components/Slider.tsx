import React, { useCallback, useEffect, useRef, useState } from 'react'

interface SliderProps {
  label?: string
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  bipolar?: boolean
  onChange(v: number): void
}

function clamp(n: number, min: number, max: number): number {
  return n < min ? min : n > max ? max : n
}

function decimalsOf(step: number): number {
  if (Number.isInteger(step)) return 0
  const s = String(step)
  const i = s.indexOf('.')
  return i < 0 ? 0 : s.length - i - 1
}

/**
 * iOS-style slider built on pointer events (not a native <input type=range>).
 * Rounded track with a filled portion (from center when `bipolar`), a raised
 * draggable thumb, and a value bubble that appears on hover/drag. Fully
 * keyboard accessible (arrows, page, home/end).
 */
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  bipolar = false,
  onChange
}: SliderProps): JSX.Element {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const [hovering, setHovering] = useState(false)

  const span = max - min || 1
  const pct = clamp((value - min) / span, 0, 1) * 100
  const decimals = decimalsOf(step)
  const display = value.toFixed(decimals)

  // Filled segment geometry — anchored at center for bipolar controls.
  let fillLeft = 0
  let fillWidth = pct
  if (bipolar) {
    const center = (0 - min) / span
    const centerPct = clamp(center, 0, 1) * 100
    const valPct = pct
    fillLeft = Math.min(centerPct, valPct)
    fillWidth = Math.abs(valPct - centerPct)
  }

  const quantize = useCallback(
    (raw: number): number => {
      const snapped = Math.round((raw - min) / step) * step + min
      const fixed = Number(clamp(snapped, min, max).toFixed(decimals + 4))
      return fixed
    },
    [min, max, step, decimals]
  )

  const setFromClientX = useCallback(
    (clientX: number): void => {
      const el = trackRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const ratio = clamp((clientX - rect.left) / (rect.width || 1), 0, 1)
      onChange(quantize(min + ratio * span))
    },
    [min, span, onChange, quantize]
  )

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      e.preventDefault()
      ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
      setDragging(true)
      setFromClientX(e.clientX)
    },
    [setFromClientX]
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      if (!dragging) return
      setFromClientX(e.clientX)
    },
    [dragging, setFromClientX]
  )

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>): void => {
    ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
    setDragging(false)
  }, [])

  // Release the body cursor lock cleanly if a drag is interrupted.
  useEffect(() => {
    if (!dragging) return
    const stop = (): void => setDragging(false)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    return () => {
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
  }, [dragging])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>): void => {
      const big = Math.max(step, span / 10)
      let next: number | null = null
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowUp':
          next = value + step
          break
        case 'ArrowLeft':
        case 'ArrowDown':
          next = value - step
          break
        case 'PageUp':
          next = value + big
          break
        case 'PageDown':
          next = value - big
          break
        case 'Home':
          next = min
          break
        case 'End':
          next = max
          break
        default:
          return
      }
      e.preventDefault()
      onChange(quantize(next))
    },
    [value, step, span, min, max, onChange, quantize]
  )

  const bubbleOpen = dragging || hovering

  return (
    <div className={`slider ${dragging ? 'is-dragging' : ''}`}>
      {(label || unit !== undefined) && (
        <div className="slider__head">
          {label && <span className="slider__label">{label}</span>}
          <span className="slider__readout">
            {display}
            {unit ? <em>{unit}</em> : null}
          </span>
        </div>
      )}
      <div
        ref={trackRef}
        className="slider__track"
        role="slider"
        tabIndex={0}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-label={label}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
      >
        <div className="slider__rail" />
        <div
          className="slider__fill"
          style={{ left: `${fillLeft}%`, width: `${fillWidth}%` }}
        />
        <div className="slider__thumb" style={{ left: `${pct}%` }}>
          <div
            className={`slider__bubble ${bubbleOpen ? 'is-open' : ''}`}
            aria-hidden
          >
            {display}
            {unit ?? ''}
          </div>
        </div>
      </div>
    </div>
  )
}
