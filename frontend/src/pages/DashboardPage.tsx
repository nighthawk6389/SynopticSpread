import { useState } from 'react'
import type { ModelRun, MonitorPoint } from '../api/client'
import { useDivergenceSummary, useMonitorPoints, useRuns } from '../api/client'
import ClickTooltip from '../components/ClickTooltip'
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
    <ClickTooltip>
      <p className="font-semibold text-white mb-1">{meta.what}</p>
      <p className="mb-2">{meta.impact}</p>
      <p className="text-gray-400">{meta.thresholds}</p>
    </ClickTooltip>
  )
}

// ─── component ────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { data: monitorPoints } = useMonitorPoints()
  const [selectedLocation, setSelectedLocation] = useState<MonitorPoint | null>(null)

  const { data: summaries, isLoading: summaryLoading } = useDivergenceSummary(
    selectedLocation ? { lat: selectedLocation.lat, lon: selectedLocation.lon } : undefined,
  )
  const { data: runs, isLoading: runsLoading } = useRuns()
  const [selectedRun, setSelectedRun] = useState<ModelRun | null>(null)

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold">Model Divergence Dashboard</h2>
        <p className="mt-1 text-sm text-gray-400">
          Ensemble spread across GFS, NAM, and ECMWF
          {selectedLocation
            ? <> — filtered to <span className="font-medium text-gray-300">{selectedLocation.label}</span></>
            : <> — computed over {monitorPoints?.length ?? 8} monitored locations</>
          }
        </p>
      </div>

      {/* Location filter */}
      <div className="flex items-center gap-3">
        <label className="text-xs text-gray-400">Location</label>
        <select
          value={selectedLocation ? `${selectedLocation.lat},${selectedLocation.lon}` : 'all'}
          onChange={e => {
            if (e.target.value === 'all') {
              setSelectedLocation(null)
            } else {
              const pt = monitorPoints?.find(
                p => `${p.lat},${p.lon}` === e.target.value,
              )
              if (pt) setSelectedLocation(pt)
            }
          }}
          className="rounded bg-gray-800 border border-gray-700 px-3 py-1.5 text-sm"
        >
          <option value="all">All Locations</option>
          {monitorPoints?.map(pt => (
            <option key={pt.label} value={`${pt.lat},${pt.lon}`}>
              {pt.label}
            </option>
          ))}
        </select>
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
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-gray-300 flex items-center">
                    {VARIABLE_LABELS[s.variable] ?? s.variable}
                    {meta && <InfoTooltip meta={meta} />}
                  </h3>
                  <span className={`text-xs rounded-full px-2 py-0.5 font-medium ${LEVEL_BADGE[level]}`}>
                    {LEVEL_LABEL[level]}
                  </span>
                </div>

                <p className="mt-3 text-2xl font-bold text-white">
                  {s.mean_spread.toFixed(2)}
                  <span className="ml-1 text-sm font-normal text-gray-400">{unit}</span>
                </p>
                <p className="text-xs text-gray-500 mt-0.5">avg ensemble spread</p>

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
                  {s.num_points} data points · {s.models_compared.join(', ')}
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
                  <span className="inline-flex items-center">
                    Lead Hours
                    <ClickTooltip>
                      <p className="font-semibold text-white mb-1">What are lead hours?</p>
                      <p className="mb-2">
                        Lead time (forecast hour) measures how far into the future a forecast is
                        valid, counted from the model's initialization time.
                      </p>
                      <p className="mb-2">
                        <strong>0h</strong> = analysis (current conditions).{' '}
                        <strong>6h</strong> = 6 hours from now.{' '}
                        <strong>24h</strong> = tomorrow.{' '}
                        <strong>120h</strong> = 5 days out.
                      </p>
                      <p className="text-gray-400">
                        Models tend to diverge more at longer lead times as small
                        differences in initial conditions amplify over time.
                      </p>
                    </ClickTooltip>
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
