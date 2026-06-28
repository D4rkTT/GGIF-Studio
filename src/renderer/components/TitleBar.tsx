import React from 'react'

interface TitleBarProps {
  title: string
  platform: 'mac' | 'win' | 'other'
  onMinimize(): void
  onMaximize(): void
  onClose(): void
}

/**
 * Frameless custom window chrome. 36px tall, the whole bar is a drag region;
 * interactive controls opt out via `-webkit-app-region: no-drag`.
 * On mac we reserve 70px on the left for the native traffic lights and render
 * no window buttons. On win/other we render minimize / maximize / close at the
 * right edge.
 */
export function TitleBar({
  title,
  platform,
  onMinimize,
  onMaximize,
  onClose
}: TitleBarProps): JSX.Element {
  const isMac = platform === 'mac'

  return (
    <div className={`titlebar ${isMac ? 'titlebar--mac' : 'titlebar--win'}`}>
      {isMac && <div className="titlebar__lights-pad" aria-hidden />}

      <div className="titlebar__title">
        <span className="titlebar__mark" aria-hidden>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
            <rect
              x="1.25"
              y="2.75"
              width="13.5"
              height="10.5"
              rx="2.25"
              stroke="currentColor"
              strokeWidth="1.3"
            />
            <path
              d="M5 8.6c0-1.6 1.2-2.7 2.9-2.7 1 0 1.8.36 2.3.92"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
            />
            <path
              d="M10.3 8v2.2H8.2"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <span className="titlebar__text">{title}</span>
      </div>

      {!isMac && (
        <div className="titlebar__controls">
          <button
            type="button"
            className="winbtn"
            onClick={onMinimize}
            aria-label="Minimize"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
              <path d="M1 5h8" stroke="currentColor" strokeWidth="1" />
            </svg>
          </button>
          <button
            type="button"
            className="winbtn"
            onClick={onMaximize}
            aria-label="Maximize"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
              <rect
                x="1.25"
                y="1.25"
                width="7.5"
                height="7.5"
                rx="1"
                stroke="currentColor"
                strokeWidth="1"
                fill="none"
              />
            </svg>
          </button>
          <button
            type="button"
            className="winbtn winbtn--close"
            onClick={onClose}
            aria-label="Close"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
              <path
                d="M1.5 1.5l7 7M8.5 1.5l-7 7"
                stroke="currentColor"
                strokeWidth="1"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}
