import { useEffect, useRef, useState } from 'react'

interface Props {
  children: React.ReactNode
}

export default function ClickTooltip({ children }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [open])

  return (
    <span ref={ref} className="relative ml-1.5 cursor-pointer inline-block">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        className="w-3.5 h-3.5 inline transition-colors"
        style={{ color: open ? 'var(--accent)' : 'var(--text-muted)' }}
        onClick={e => {
          e.stopPropagation()
          setOpen(o => !o)
        }}
      >
        <path
          fillRule="evenodd"
          d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM9 9a1 1 0 112 0v5a1 1 0 11-2 0V9zm1-4a1 1 0 100 2 1 1 0 000-2z"
          clipRule="evenodd"
        />
      </svg>
      {open && (
        <div
          className="absolute left-0 top-full mt-2 z-50 w-72 rounded-xl text-xs p-4 leading-relaxed animate-scale-in"
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.1)',
            color: 'var(--text-secondary)',
          }}
        >
          {children}
        </div>
      )}
    </span>
  )
}
