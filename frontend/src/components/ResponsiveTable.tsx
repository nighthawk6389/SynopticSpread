import type { ReactNode } from 'react'

export interface Column<T> {
  key: string
  header: string
  render: (row: T) => ReactNode
}

interface ResponsiveTableProps<T> {
  columns: Column<T>[]
  data: T[]
  keyFn: (row: T) => string
  onRowClick?: (row: T) => void
  emptyMessage?: string
}

export default function ResponsiveTable<T>({
  columns,
  data,
  keyFn,
  onRowClick,
  emptyMessage = 'No data.',
}: ResponsiveTableProps<T>) {
  if (data.length === 0) {
    return (
      <div className="glass-card p-10 text-center">
        <p style={{ color: 'var(--text-tertiary)' }}>{emptyMessage}</p>
      </div>
    )
  }

  return (
    <>
      {/* Desktop table */}
      <div className="hidden md:block glass-card overflow-hidden" style={{ borderRadius: '16px' }}>
        <table className="data-table">
          <thead>
            <tr>
              {columns.map(col => (
                <th key={col.key}>{col.header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map(row => (
              <tr
                key={keyFn(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={onRowClick ? 'cursor-pointer' : undefined}
              >
                {columns.map(col => (
                  <td key={col.key}>{col.render(row)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {data.map(row => (
          <div
            key={keyFn(row)}
            className="glass-card p-4 space-y-2"
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            role={onRowClick ? 'button' : undefined}
            tabIndex={onRowClick ? 0 : undefined}
          >
            {columns.map(col => (
              <div key={col.key} className="flex justify-between items-center gap-2">
                <span
                  className="text-xs font-medium shrink-0"
                  style={{ color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}
                >
                  {col.header}
                </span>
                <span className="text-sm text-right" style={{ color: 'var(--text-secondary)' }}>
                  {col.render(row)}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  )
}
