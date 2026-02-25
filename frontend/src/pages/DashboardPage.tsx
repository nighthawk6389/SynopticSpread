import { useDivergenceSummary, useRuns } from '../api/client'

const VARIABLE_LABELS: Record<string, string> = {
  precip: 'Precipitation',
  wind_speed: 'Wind Speed',
  mslp: 'Sea-Level Pressure',
  hgt_500: '500mb Heights',
}

const VARIABLE_UNITS: Record<string, string> = {
  precip: 'mm',
  wind_speed: 'm/s',
  mslp: 'Pa',
  hgt_500: 'm',
}

export default function DashboardPage() {
  const { data: summaries, isLoading: summaryLoading } = useDivergenceSummary()
  const { data: runs, isLoading: runsLoading } = useRuns()

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold">Model Divergence Dashboard</h2>
        <p className="mt-1 text-sm text-gray-400">
          Overview of forecast divergence across GFS, NAM, and ECMWF
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {summaryLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="animate-pulse rounded-lg bg-gray-800 p-5 h-32" />
          ))
        ) : summaries && summaries.length > 0 ? (
          summaries.map(s => (
            <div key={s.variable} className="rounded-lg bg-gray-800 border border-gray-700 p-5">
              <h3 className="text-sm font-medium text-gray-400">
                {VARIABLE_LABELS[s.variable] ?? s.variable}
              </h3>
              <p className="mt-2 text-2xl font-bold text-white">
                {s.mean_spread.toFixed(2)}{' '}
                <span className="text-sm font-normal text-gray-500">
                  {VARIABLE_UNITS[s.variable] ?? ''} avg spread
                </span>
              </p>
              <p className="mt-1 text-xs text-gray-500">
                Max: {s.max_spread.toFixed(2)} | {s.num_points} points
              </p>
            </div>
          ))
        ) : (
          <div className="col-span-full rounded-lg bg-gray-800 border border-gray-700 p-8 text-center text-gray-500">
            No divergence data yet. Waiting for model ingestion to complete.
          </div>
        )}
      </div>

      {/* Recent Model Runs */}
      <div>
        <h3 className="text-lg font-semibold mb-3">Recent Model Runs</h3>
        <div className="overflow-hidden rounded-lg border border-gray-700">
          <table className="w-full text-sm">
            <thead className="bg-gray-800">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-400">Model</th>
                <th className="px-4 py-2 text-left font-medium text-gray-400">Init Time</th>
                <th className="px-4 py-2 text-left font-medium text-gray-400">Status</th>
                <th className="px-4 py-2 text-left font-medium text-gray-400">Lead Hours</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {runsLoading ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-gray-500">Loading...</td>
                </tr>
              ) : runs && runs.length > 0 ? (
                runs.map(run => (
                  <tr key={run.id} className="hover:bg-gray-800/50">
                    <td className="px-4 py-2 font-medium">{run.model_name}</td>
                    <td className="px-4 py-2 text-gray-300">
                      {new Date(run.init_time).toUTCString()}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                          run.status === 'complete'
                            ? 'bg-green-900 text-green-300'
                            : run.status === 'error'
                              ? 'bg-red-900 text-red-300'
                              : 'bg-yellow-900 text-yellow-300'
                        }`}
                      >
                        {run.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-gray-400">
                      {run.forecast_hours.length > 0
                        ? `${run.forecast_hours[0]}h - ${run.forecast_hours[run.forecast_hours.length - 1]}h`
                        : '-'}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                    No model runs ingested yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
