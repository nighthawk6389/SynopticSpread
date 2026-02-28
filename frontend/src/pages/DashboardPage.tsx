import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import type { DivergenceSummary, ModelRun, MonitorPoint } from '../api/client'
import { useActiveAlerts, useDecomposition, useDivergenceHistory, useDivergenceSummary, useMonitorPoints, useRuns } from '../api/client'
import ClickTooltip from '../components/ClickTooltip'
import ResponsiveTable from '../components/ResponsiveTable'
import type { Column } from '../components/ResponsiveTable'
import RunDetailModal from '../components/RunDetailModal'
import Sparkline from '../components/Sparkline'
import { useUrlState } from '../hooks/useUrlState'

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

const VARIABLE_ICONS: Record<string, string> = {
  precip: 'M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z',
  wind_speed: 'M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z',
  mslp: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
  hgt_500: 'M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
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

const LEVEL_CARD: Record<SpreadLevel, string> = {
  normal: 'status-card-normal',
  elevated: 'status-card-elevated',
  high: 'status-card-high',
}

const LEVEL_BADGE: Record<SpreadLevel, string> = {
  normal: 'badge-green',
  elevated: 'badge-yellow',
  high: 'badge-red',
}

const LEVEL_LABEL: Record<SpreadLevel, string> = {
  normal: 'Normal',
  elevated: 'Elevated',
  high: 'High',
}

const LEVEL_COLOR: Record<SpreadLevel, string> = {
  normal: 'var(--green)',
  elevated: 'var(--yellow)',
  high: 'var(--red)',
}

// ─── info tooltip ─────────────────────────────────────────────────────────────

function InfoTooltip({ meta }: { meta: VariableMeta }) {
  return (
    <ClickTooltip>
      <p className="font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>{meta.what}</p>
      <p className="mb-2" style={{ color: 'var(--text-secondary)' }}>{meta.impact}</p>
      <p style={{ color: 'var(--text-tertiary)' }}>{meta.thresholds}</p>
    </ClickTooltip>
  )
}

// ─── summary card with sparkline ──────────────────────────────────────────────

function SummaryCard({ s, index, selectedLocation }: { s: DivergenceSummary; index: number; selectedLocation: MonitorPoint | null }) {
  const level = spreadLevel(s.variable, s.mean_spread)
  const unit = VARIABLE_UNITS[s.variable] ?? ''
  const meta = VARIABLE_META[s.variable]
  const iconPath = VARIABLE_ICONS[s.variable]

  const { data: history } = useDivergenceHistory({
    variable: s.variable,
    hours_back: 48,
    lat: selectedLocation?.lat,
    lon: selectedLocation?.lon,
  })

  return (
    <div
      className={`glass-card p-5 animate-slide-up delay-${index + 1} ${LEVEL_CARD[level]}`}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
              strokeWidth={1.5} stroke="currentColor" className="w-4.5 h-4.5"
              style={{ color: 'var(--text-secondary)' }}>
              <path strokeLinecap="round" strokeLinejoin="round" d={iconPath} />
            </svg>
          </div>
          <div className="flex items-center">
            <h3 className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
              {VARIABLE_LABELS[s.variable] ?? s.variable}
            </h3>
            {meta && <InfoTooltip meta={meta} />}
          </div>
        </div>
        <span className={`badge ${LEVEL_BADGE[level]}`}>
          {LEVEL_LABEL[level]}
        </span>
      </div>

      <p className="text-3xl font-bold tracking-tight" style={{ fontFamily: 'var(--font-display)' }}>
        {s.mean_spread.toFixed(2)}
        <span className="ml-1.5 text-sm font-normal" style={{ color: 'var(--text-tertiary)' }}>{unit}</span>
      </p>
      <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>avg ensemble spread</p>

      {history && history.points.length >= 2 && (
        <div className="mt-3">
          <Sparkline data={history.points} color={LEVEL_COLOR[level]} />
        </div>
      )}

      <div className="mt-3 grid grid-cols-4 gap-2">
        {[
          { label: 'Min', value: s.min_spread },
          { label: 'Median', value: s.median_spread },
          { label: 'Avg', value: s.mean_spread },
          { label: 'Max', value: s.max_spread },
        ].map(stat => (
          <div key={stat.label} className="rounded-lg p-2" style={{ background: 'var(--bg-elevated)' }}>
            <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{stat.label}</p>
            <p className="text-xs font-semibold mt-0.5" style={{ color: 'var(--text-secondary)' }}>{stat.value != null ? stat.value.toFixed(2) : '—'}</p>
          </div>
        ))}
      </div>

      <p className="mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
        0–48h forecast window · {s.num_points} points · {s.models_compared.join(', ')}
      </p>
    </div>
  )
}

// ─── runs table columns ───────────────────────────────────────────────────────

const RUNS_COLUMNS: Column<ModelRun>[] = [
  {
    key: 'model',
    header: 'Model',
    render: (run) => (
      <span className="font-semibold" style={{ fontFamily: 'var(--font-display)' }}>{run.model_name}</span>
    ),
  },
  {
    key: 'init_time',
    header: 'Init Time (UTC)',
    render: (run) => (
      <span style={{ color: 'var(--text-secondary)' }}>{new Date(run.init_time).toUTCString()}</span>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    render: (run) => (
      <span className={`badge ${
        run.status === 'complete' ? 'badge-green' : run.status === 'error' ? 'badge-red' : 'badge-yellow'
      }`}>{run.status}</span>
    ),
  },
  {
    key: 'lead_hours',
    header: 'Lead Hours',
    render: (run) => (
      <span style={{ color: 'var(--text-tertiary)' }}>
        {run.forecast_hours.length > 0
          ? `${run.forecast_hours[0]}h – ${run.forecast_hours[run.forecast_hours.length - 1]}h (${run.forecast_hours.length} steps)`
          : '—'}
      </span>
    ),
  },
]

// ─── component ────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { data: monitorPoints } = useMonitorPoints()
  const [locationParam, setLocationParam] = useUrlState('location', '')

  const selectedLocation = (() => {
    if (!locationParam || !monitorPoints) return null
    const pt = monitorPoints.find(p => `${p.lat},${p.lon}` === locationParam)
    return pt ?? null
  })()

  const { data: summaries, isLoading: summaryLoading } = useDivergenceSummary(
    selectedLocation ? { lat: selectedLocation.lat, lon: selectedLocation.lon } : undefined,
  )
  const { data: runs, isLoading: runsLoading } = useRuns()
  const [selectedRun, setSelectedRun] = useState<ModelRun | null>(null)
  const { data: activeAlerts } = useActiveAlerts()

  const decompLocation = selectedLocation ?? { lat: 40.7128, lon: -74.006 }
  const { data: decomposition } = useDecomposition({
    variable: 'precip',
    lat: decompLocation.lat,
    lon: decompLocation.lon,
  })

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Alert banner */}
      {activeAlerts && activeAlerts.length > 0 && (
        <div className="glass-card animate-slide-down flex items-center gap-4 px-5 py-4"
          style={{ borderColor: 'var(--red-border)', background: 'var(--red-dim)' }}>
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: 'var(--red-dim)', border: '1px solid var(--red-border)' }}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"
              className="w-5 h-5" style={{ color: 'var(--red)' }}>
              <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold" style={{ color: 'var(--red)' }}>
              {activeAlerts.length} active alert{activeAlerts.length > 1 ? 's' : ''}
            </p>
            <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-tertiary)' }}>
              {activeAlerts.slice(0, 3).map(a =>
                `${a.variable} ${a.location_label ? `at ${a.location_label}` : ''} (${a.value.toFixed(2)})`
              ).join(', ')}
              {activeAlerts.length > 3 && ` and ${activeAlerts.length - 3} more`}
            </p>
          </div>
          <NavLink to="/alerts" className="btn-ghost shrink-0 text-xs" style={{ color: 'var(--red)', borderColor: 'var(--red-border)' }}>
            View alerts
          </NavLink>
        </div>
      )}

      {/* Page header */}
      <div className="animate-slide-up">
        <h2 className="section-title text-2xl" style={{ fontFamily: 'var(--font-display)' }}>
          Model Divergence Dashboard
        </h2>
        <p className="section-subtitle mt-2">
          Ensemble spread across all tracked models
          {selectedLocation
            ? <> — filtered to <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{selectedLocation.label}</span></>
            : <> — computed over {monitorPoints?.length ?? 8} monitored locations</>
          }
        </p>
      </div>

      {/* Location filter */}
      <div className="flex items-center gap-3 animate-slide-up delay-1">
        <label className="text-xs font-medium" style={{ color: 'var(--text-tertiary)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
          Location
        </label>
        <select
          value={locationParam || 'all'}
          onChange={e => {
            setLocationParam(e.target.value === 'all' ? '' : e.target.value)
          }}
          className="control-select"
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
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {summaryLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={`skeleton-shimmer h-[180px] delay-${i + 1}`} />
          ))
        ) : summaries && summaries.length > 0 ? (
          summaries.map((s, i) => (
            <SummaryCard key={s.variable} s={s} index={i} selectedLocation={selectedLocation} />
          ))
        ) : (
          <div className="col-span-full glass-card p-10 text-center">
            <p style={{ color: 'var(--text-tertiary)' }}>No divergence data yet. Trigger a model run from the admin panel.</p>
          </div>
        )}
      </div>

      {/* Pair Contributions */}
      {decomposition && decomposition.length > 0 && (
        <div className="animate-slide-up delay-5">
          <h3 className="section-title text-lg mb-1" style={{ fontFamily: 'var(--font-display)' }}>Pair Contributions</h3>
          <p className="section-subtitle mb-4">
            Which model pair is most divergent (RMSE by lead hour, precipitation at {selectedLocation?.label ?? 'New York'}).
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(() => {
              const pairTotals: Record<string, { rmse: number; count: number }> = {}
              for (const entry of decomposition) {
                for (const pair of entry.pairs) {
                  const key = pair.model_a < pair.model_b
                    ? `${pair.model_a}-${pair.model_b}`
                    : `${pair.model_b}-${pair.model_a}`
                  if (!pairTotals[key]) pairTotals[key] = { rmse: 0, count: 0 }
                  pairTotals[key].rmse += pair.rmse
                  pairTotals[key].count += 1
                }
              }
              const pairs = Object.entries(pairTotals)
                .map(([key, { rmse, count }]) => ({ pair: key, avgRmse: rmse / count }))
                .sort((a, b) => b.avgRmse - a.avgRmse)
              const maxRmse = Math.max(...pairs.map(p => p.avgRmse), 0.01)

              return pairs.map(({ pair, avgRmse }, i) => {
                const ratio = avgRmse / maxRmse
                const barColor = ratio > 0.66 ? 'var(--red)' : ratio > 0.33 ? 'var(--yellow)' : 'var(--green)'
                return (
                  <div key={pair} className={`glass-card p-4 animate-slide-up delay-${Math.min(i + 1, 6)}`}>
                    <div className="flex justify-between text-sm mb-2">
                      <span className="font-semibold" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
                        {pair}
                      </span>
                      <span className="font-mono text-xs" style={{ color: 'var(--text-tertiary)' }}>
                        {avgRmse.toFixed(3)}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border-subtle)' }}>
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{
                          width: `${ratio * 100}%`,
                          backgroundColor: barColor,
                          boxShadow: `0 0 8px ${barColor}40`,
                        }}
                      />
                    </div>
                  </div>
                )
              })
            })()}
          </div>
        </div>
      )}

      {/* Recent Model Runs */}
      <div className="animate-slide-up delay-6">
        <h3 className="section-title text-lg mb-1" style={{ fontFamily: 'var(--font-display)' }}>Recent Model Runs</h3>
        <p className="section-subtitle mb-4">
          Click a row to inspect point-level metrics for that run.
        </p>
        {runsLoading ? (
          <div className="glass-card p-10 text-center" style={{ color: 'var(--text-tertiary)' }}>Loading…</div>
        ) : (
          <ResponsiveTable
            columns={RUNS_COLUMNS}
            data={runs ?? []}
            keyFn={run => run.id}
            onRowClick={setSelectedRun}
            emptyMessage="No model runs yet."
          />
        )}
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
