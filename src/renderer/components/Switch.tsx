import React from 'react'

interface SwitchProps {
  checked: boolean
  onChange(v: boolean): void
  label?: string
}

/** iOS-style toggle. Spring-driven thumb, cross-fading track. */
export function Switch({ checked, onChange, label }: SwitchProps): JSX.Element {
  const toggle = (
    <span className={`switch ${checked ? 'is-on' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={label}
      />
      <span className="switch__track" />
      <span className="switch__thumb" />
    </span>
  )

  if (!label) return toggle

  return (
    <label className="switch-row">
      <span className="switch-row__label">{label}</span>
      {toggle}
    </label>
  )
}
