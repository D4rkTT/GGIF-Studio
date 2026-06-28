import React from 'react'
import { PANELS, ICONS } from './panels'

interface ToolRailProps {
  open: Record<string, boolean>
  onToggle(id: string): void
}

/**
 * Slim vertical icon rail docked on the LEFT edge. Each button toggles its
 * floating panel open/closed and lights up while that panel is on screen.
 */
export function ToolRail({ open, onToggle }: ToolRailProps): JSX.Element {
  return (
    <nav className="rail-root" aria-label="Tools">
      {PANELS.map((p) => {
        const active = open[p.id] === true
        return (
          <button
            key={p.id}
            type="button"
            className={`rail-btn ${active ? 'is-active' : ''}`}
            aria-pressed={active}
            title={p.title}
            onClick={() => onToggle(p.id)}
          >
            <span className="rail-icon">{ICONS[p.id]}</span>
            <span className="rail-label">{p.title}</span>
          </button>
        )
      })}
    </nav>
  )
}
