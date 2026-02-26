import { useState } from 'react'
import type { ModelRun } from '../api/client'
import { useDivergenceSummary, useMonitorPoints, useRuns } from '../api/client'
import RunDetailModal from '../components/RunDetailModal'

// ─── variable metadata ────────────────────────────────────────────────────────

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

interface VariableMeta {
  what: string
  impact: string
  thresholds: string
}

const VARIABLE_META: Record<string, VariableMeta> = {
  precip: {
    what: 'Total accumulated precipitation at the surface.',
    impact:
      'High spread means models disagree on where rain falls and how much accumulates — directly impacts flood risk, drought outlooks, and water resource planning.',
    thresholds: 'Low: < 3 mm · Elevated: 3 – 8 mm · High: > 8 mm',
  },
  wind_speed: {
    what: '10-meter wind speed above the surface.',
    impact:
      'Large spread indicates disagreement in storm track or boundary-layer winds. Significant for aviation, severe weather outlooks, and wind energy dispatch.',
    thresholds: 'Low: < 2 m/s · Elevated: 2 – 5 m/s · High: > 5 m/s',
  },
  mslp: {
    what: 'Mean sea-level pressure — the atmospheric pressure adjusted to sea level.',
    impact:
      'Divergence reveals disagreement in the position or strength of cyclones and anticyclones. The primary driver of uncertainty in storm-track forecasts.',
    thresholds: 'Low: < 100 Pa · Elevated: 100 – 300 Pa · High: > 300 Pa',
  },
  hgt_500: {
    what: '500 mb geopotential height — the altitude of the mid-troposphere pressure surface.',
    impact:
      'The primary steering-flow indicator. High spread means models see fundamentally different mid-atmosphere patterns, cascading uncertainty into all surface forecasts.',
    thresholds: 'Low: < 20 m · Elevated: 20 – 60 m · High: > 60 m',
  },
}

// Thresholds for red/yellow/green card coloring (based on mean_spread)
const THRESHOLDS: Record<string, { warn: number; alert: number }> = {
  precip: { warn: 3, alert: 8 },
  wind_speed: { warn: 2, alert: 5 },
  mslp: { warn: 100, alert: 300 },
  hgt_500: { warn: 20, alert: 60 },
}

type SpreadLevel = 'normal' | 'elevated' | 'high'

function spreadLevel(variable: string, mean: number): SpreadLevel {
  const t = THRESHOLDS[variable]
  if (!t) return 'normal'
  if (mean >= t.alert) return 'high'
  if (mean >= t.warn) return 'elevated'
  return 'normal'
}

const LEVEL_STYLES: Record<SpreadLevel, string> = {
  normal: 'border-green-700 bg-green-950/30',
  elevated: 'border-yellow-600 bg-yellow-950/30',
  high: 'border-red-600 bg-red-950/30',
}

const LEVEL_BADGE: Record<SpreadLevel, string> = {
  normal: 'bg-green-900 text-green-300',
  elevated: 'bg-yellow-900 text-yellow-300',
  high: 'bg-red-900 text-red-300',
}

const LEVEL_LABEL: Record<SpreadLevel, string> = {
  normal: 'Normal',
  elevated: 'Elevated',
  high: 'High',
}

// ─── info tooltip ─────────────────────────────────────────────────────────────

function InfoTooltip({ meta }: { meta: VariableMeta }) {
  return (
    <span className="relative group ml-1 cursor-help">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        className="w-3.5 h-3.5 text-gray-500 hover:text-gray-300 inline"
      >
        <path
          fillRule="evenodd"
          d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM9 9a1 1 0 112 0v5a1 1 0 11-2 0V9zm1-4a1 1 0 100 2 1 1 0 000-2z"
          clipRule="evenodd"
        />
      </svg>
      <div className="absolute left-0 top-full mt-2 z-50 hidden group-hover:block w-72 rounded bg-gray-700 text-gray-200 text-xs p-3 shadow-xl leading-relaxed pointer-events-none">
        <p className="font-semibold text-white mb-1">{meta.what}</p>
        <p className="mb-2">{meta.impact}</p>
        <p className="text-gray-400">{meta.thresholds}</p>
      </div>
    </span>
  )
}

// ─── component ────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { data: summaries, isLoading: summaryLoading } = useDivergenceSummary()
  const { data: runs, isLoading: runsLoading } = useRuns()
  const { data: monitorPoints } = useMonitorPoints()
  const [selectedRun, setSelectedRun] = useState<ModelRun | null>(null)

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold">Model Divergence Dashboard</h2>
        <p className="mt-1 text-sm text-gray-400">
          Ensemble spread across GFS, NAM, and ECMWF — computed over{' '}
          <span
            className="underline decoration-dotted cursor-help"
            title="Monitored locations are pre-configured cities (New York, Los Angeles, Chicago, Houston, Seattle, Denver, Miami, Washington DC). Each variable is sampled at every location for every available forecast lead time."
          >
            {monitorPoints?.length ?? 8} monitored locations
          </span>
          .
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {summaryLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="animate-pulse rounded-lg bg-gray-800 p-5 h-32" />
          ))
        ) : summaries && summaries.length > 0 ? (
          summaries.map(s => {
            const level = spreadLevel(s.variable, s.mean_spread)
            const unit = VARIABLE_UNITS[s.variable] ?? ''
            const meta = VARIABLE_META[s.variable]
            return (
              <div
                key={s.variable}
                className={`rounded-lg border p-5 transition-colors ${LEVEL_STYLES[level]}`}
              >
                {/* Card header */}
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-gray-300 flex items-center">
                    {VARIABLE_LABELS[s.variable] ?? s.variable}
                    {meta && <InfoTooltip meta={meta} />}
                  </h3>
                  <span className={`text-xs rounded-full px-2 py-0.5 font-medium ${LEVEL_BADGE[level]}`}>
                    {LEVEL_LABEL[level]}
                  </span>
                </div>

                {/* Primary stat */}
                <p className="mt-3 text-2xl font-bold text-white">
                  {s.mean_spread.toFixed(2)}
                  <span className="ml-1 text-sm font-normal text-gray-400">{unit}</span>
                </p>
                <p className="text-xs text-gray-500 mt-0.5">avg ensemble spread</p>

                {/* Secondary stats */}
                <div className="mt-3 grid grid-cols-3 gap-1 text-xs">
                  <div>
                    <p className="text-gray-500">Min</p>
                    <p className="font-medium text-gray-300">{s.min_spread.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Avg</p>
                    <p className="font-medium text-gray-300">{s.mean_spread.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Max</p>
                    <p className="font-medium text-gray-300">{s.max_spread.toFixed(2)}</p>
                  </div>
                </div>

                <p className="mt-2 text-xs text-gray-600">
                  {s.num_points}{' '}
                  <span
                    className="underline decoration-dotted cursor-help"
                    title="Each point is one variable measurement at one monitored city for one forecast lead time."
                  >
                    data points
                  </span>
                  {' '}· {s.models_compared.join(', ')}
                </p>
              </div>
            )
          })
        ) : (
          <div className="col-span-full rounded-lg bg-gray-800 border border-gray-700 p-8 text-center text-gray-500">
            No divergence data yet. Trigger a model run from the admin panel.
          </div>
        )}
      </div>

      {/* Recent Model Runs */}
      <div>
        <h3 className="text-lg font-semibold mb-1">Recent Model Runs</h3>
        <p className="text-xs text-gray-500 mb-3">
          Click a row to inspect point-level metrics for that run.
        </p>
        <div className="overflow-hidden rounded-lg border border-gray-700">
          <table className="w-full text-sm">
            <thead className="bg-gray-800">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-400">Model</th>
                <th className="px-4 py-2 text-left font-medium text-gray-400">Init Time (UTC)</th>
                <th className="px-4 py-2 text-left font-medium text-gray-400">Status</th>
                <th className="px-4 py-2 text-left font-medium text-gray-400">
                  <span
                    className="underline decoration-dotted cursor-help"
                    title="Lead hours for which this run has data. Each step is 6 hours apart."
                  >
                    Lead Hours
                  </span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {runsLoading ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-gray-500">Loading…</td>
                </tr>
              ) : runs && runs.length > 0 ? (
                runs.map(run => (
                  <tr
                    key={run.id}
                    onClick={() => setSelectedRun(run)}
                    className="hover:bg-gray-800/60 cursor-pointer"
                  >
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
                        ? `${run.forecast_hours[0]}h – ${run.forecast_hours[run.forecast_hours.length - 1]}h (${run.forecast_hours.length} steps)`
                        : '—'}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                    No model runs yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Run detail modal */}
      {selectedRun && (
        <RunDetailModal
          run={selectedRun}
          monitorPoints={monitorPoints ?? []}
          onClose={() => setSelectedRun(null)}
        />
      )}
    </div>
  )
}
