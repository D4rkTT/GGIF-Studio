import React from 'react'

interface FieldProps {
  label: string
  hint?: string
  children: React.ReactNode
}

/** A labeled control row. Label (and optional hint) on the left, control right. */
export function Field({ label, hint, children }: FieldProps): JSX.Element {
  return (
    <div className="field-row">
      <div className="field-row__meta">
        <span className="field-row__label">{label}</span>
        {hint && <span className="field-row__hint">{hint}</span>}
      </div>
      <div className="field-row__control">{children}</div>
    </div>
  )
}
