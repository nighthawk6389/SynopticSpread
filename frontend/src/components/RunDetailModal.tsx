import type { ModelRun, MonitorPoint } from '../api/client'
import { useRunMetrics } from '../api/client'

const VARIABLE_LABELS: Record<string, string> = {
  precip: 'Precip',
  wind_speed: 'Wind',
  mslp: 'MSLP',
  hgt_500: '500mb Hgt',
}

const VARIABLE_UNITS: Record<string, string> = {
  precip: 'mm',
  wind_speed: 'm/s',
  mslp: 'Pa',
  hgt_500: 'm',
}

interface Props {
  run: ModelRun
  monitorPoints: MonitorPoint[]
  onClose: () => void
}

function resolveLabel(lat: number, lon: number, points: MonitorPoint[]): string {
  const match = points.find(p => Math.abs(p.lat - lat) < 0.1 && Math.abs(p.lon - lon) < 0.1)
  return match ? match.label : `${lat.toFixed(2)}, ${lon.toFixed(2)}`
}

export default function RunDetailModal({ run, monitorPoints, onClose }: Props) {
  const { data: metrics, isLoading } = useRunMetrics(run.id)

  const seen = new Set<string>()
  const unique = (metrics ?? []).filter(m => {
    const key = `${m.variable}|${m.lat}|${m.lon}|${m.lead_hour}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const grouped: Record<string, typeof unique> = {}
  for (const m of unique) {
    if (!grouped[m.variable]) grouped[m.variable] = []
    grouped[m.variable].push(m)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in"
      style={{ background: 'rgba(6, 11, 24, 0.8)', backdropFilter: 'blur(8px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full max-w-3xl max-h-[85vh] flex flex-col animate-scale-in"
        style={{
          background: 'var(--bg-base)',
          border: '1px solid var(--border-default)',
          borderRadius: '20px',
          boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
        }}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-6" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <div>
            <h2 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
              {run.model_name} Run Details
            </h2>
            <p className="text-sm mt-1" style={{ color: 'var(--text-tertiary)' }}>
              Init: {new Date(run.init_time).toUTCString()}
            </p>
            <div className="flex gap-4 mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
              <span>Status: <span style={{ color: 'var(--text-secondary)' }}>{run.status}</span></span>
              <span>
                Forecast hours:{' '}
                <span style={{ color: 'var(--text-secondary)' }}>
                  {run.forecast_hours.length > 0
                    ? `${run.forecast_hours[0]}h – ${run.forecast_hours[run.forecast_hours.length - 1]}h (${run.forecast_hours.length} steps)`
                    : '—'}
                </span>
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg transition-colors"
            style={{ color: 'var(--text-tertiary)' }}
            aria-label="Close"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-6 space-y-6 flex-1">
          {isLoading ? (
            <div className="flex items-center gap-3 py-8" style={{ color: 'var(--text-tertiary)' }}>
              <div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
              Loading metrics…
            </div>
          ) : unique.length === 0 ? (
            <p className="text-sm py-8" style={{ color: 'var(--text-tertiary)' }}>No point metrics found for this run.</p>
          ) : (
            Object.entries(grouped).map(([variable, rows]) => (
              <div key={variable}>
                <h3 className="text-sm font-semibold mb-3" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-secondary)' }}>
                  {VARIABLE_LABELS[variable] ?? variable}
                  <span className="ml-1.5 text-xs font-normal" style={{ color: 'var(--text-muted)' }}>
                    ({VARIABLE_UNITS[variable] ?? ''})
                  </span>
                </h3>
                <div className="overflow-x-auto rounded-xl" style={{ border: '1px solid var(--border-subtle)' }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Location</th>
                        <th>Lead hr</th>
                        <th>Spread</th>
                        <th>RMSE</th>
                        <th>Bias</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(m => (
                        <tr key={m.id}>
                          <td style={{ color: 'var(--text-secondary)' }}>
                            {resolveLabel(m.lat, m.lon, monitorPoints)}
                          </td>
                          <td style={{ color: 'var(--text-tertiary)' }}>{m.lead_hour}h</td>
                          <td className="font-mono text-xs">{m.spread.toFixed(3)}</td>
                          <td className="font-mono text-xs">{m.rmse.toFixed(3)}</td>
                          <td className="font-mono text-xs">{m.bias.toFixed(3)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
