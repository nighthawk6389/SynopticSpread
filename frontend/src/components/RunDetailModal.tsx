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

  // Deduplicate: keep first occurrence per variable+lat+lon+lead_hour
  const seen = new Set<string>()
  const unique = (metrics ?? []).filter(m => {
    const key = `${m.variable}|${m.lat}|${m.lon}|${m.lead_hour}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  // Group by variable
  const grouped: Record<string, typeof unique> = {}
  for (const m of unique) {
    if (!grouped[m.variable]) grouped[m.variable] = []
    grouped[m.variable].push(m)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-gray-700">
          <div>
            <h2 className="text-lg font-bold">
              {run.model_name} Run Details
            </h2>
            <p className="text-sm text-gray-400 mt-0.5">
              Init: {new Date(run.init_time).toUTCString()}
            </p>
            <div className="flex gap-3 mt-1 text-xs text-gray-500">
              <span>Status: <span className="text-gray-300">{run.status}</span></span>
              <span>
                Forecast hours:{' '}
                <span className="text-gray-300">
                  {run.forecast_hours.length > 0
                    ? `${run.forecast_hours[0]}h – ${run.forecast_hours[run.forecast_hours.length - 1]}h (${run.forecast_hours.length} steps)`
                    : '—'}
                </span>
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-xl leading-none mt-0.5"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-5 space-y-5 flex-1">
          {isLoading ? (
            <p className="text-gray-500 text-sm">Loading metrics…</p>
          ) : unique.length === 0 ? (
            <p className="text-gray-500 text-sm">No point metrics found for this run.</p>
          ) : (
            Object.entries(grouped).map(([variable, rows]) => (
              <div key={variable}>
                <h3 className="text-sm font-semibold text-gray-300 mb-2">
                  {VARIABLE_LABELS[variable] ?? variable}
                  <span className="ml-1 text-xs font-normal text-gray-500">
                    ({VARIABLE_UNITS[variable] ?? ''})
                  </span>
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="text-left text-gray-500 border-b border-gray-700">
                        <th className="pb-1 pr-4 font-medium">Location</th>
                        <th className="pb-1 pr-4 font-medium">Lead&nbsp;hr</th>
                        <th className="pb-1 pr-4 font-medium">Spread</th>
                        <th className="pb-1 pr-4 font-medium">RMSE</th>
                        <th className="pb-1 font-medium">Bias</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800">
                      {rows.map(m => (
                        <tr key={m.id} className="hover:bg-gray-800/40">
                          <td className="py-1 pr-4 text-gray-300">
                            {resolveLabel(m.lat, m.lon, monitorPoints)}
                          </td>
                          <td className="py-1 pr-4 text-gray-400">{m.lead_hour}h</td>
                          <td className="py-1 pr-4">{m.spread.toFixed(3)}</td>
                          <td className="py-1 pr-4">{m.rmse.toFixed(3)}</td>
                          <td className="py-1">{m.bias.toFixed(3)}</td>
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
