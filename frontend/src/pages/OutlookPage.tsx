import { useState } from 'react'
import { type ModelPointValue, useModelValues, useMonitorPoints } from '../api/client'
import { useUrlState } from '../hooks/useUrlState'

// ── Unit conversion helpers ───────────────────────────────────────────────────

function mmToIn(mm: number) {
  return mm / 25.4
}

function msToMph(ms: number) {
  return ms * 2.237
}

function paToHpa(pa: number) {
  return pa / 100
}

function formatValue(variable: string, rawValue: number): { display: string; unit: string; converted: number } {
  switch (variable) {
    case 'precip': {
      const v = mmToIn(rawValue)
      return { display: v.toFixed(2), unit: 'in', converted: v }
    }
    case 'wind_speed': {
      const v = msToMph(rawValue)
      return { display: v.toFixed(1), unit: 'mph', converted: v }
    }
    case 'mslp': {
      const v = paToHpa(rawValue)
      return { display: v.toFixed(1), unit: 'hPa', converted: v }
    }
    case 'hgt_500':
      return { display: rawValue.toFixed(0), unit: 'm', converted: rawValue }
    default:
      return { display: rawValue.toFixed(2), unit: '', converted: rawValue }
  }
}

// ── Plain-language descriptors ────────────────────────────────────────────────

function getLabel(variable: string, converted: number, display: string, unit: string): string {
  const val = `${display} ${unit}`
  switch (variable) {
    case 'precip':
      if (converted === 0) return `No precipitation · ${val}`
      if (converted < 0.01) return `Trace precipitation · ${val}`
      if (converted < 0.25) return `Light precipitation · ${val}`
      if (converted < 1.0) return `Moderate precipitation · ${val}`
      if (converted < 2.5) return `Heavy precipitation · ${val}`
      if (converted < 5.0) return `Very heavy precipitation · ${val}`
      return `Extreme precipitation · ${val}`
    case 'wind_speed':
      if (converted < 5) return `Calm · ${val}`
      if (converted < 15) return `Light breeze · ${val}`
      if (converted < 25) return `Breezy · ${val}`
      if (converted < 40) return `Windy · ${val}`
      if (converted < 58) return `Very windy · ${val}`
      return `Storm-force winds · ${val}`
    case 'mslp':
      if (converted < 980) return `Deep low pressure · ${val}`
      if (converted < 990) return `Strong low pressure · ${val}`
      if (converted < 1005) return `Low pressure · ${val}`
      if (converted < 1015) return `Near-normal pressure · ${val}`
      if (converted < 1025) return `Slightly high pressure · ${val}`
      return `High pressure · ${val}`
    case 'hgt_500':
      if (converted < 5300) return `Deep trough · ${val}`
      if (converted < 5500) return `Below-normal heights · ${val}`
      if (converted < 5700) return `Slightly below normal · ${val}`
      if (converted < 5900) return `Near-normal heights · ${val}`
      if (converted < 6000) return `Slightly above normal · ${val}`
      return `Strong ridge · ${val}`
    default:
      return val
  }
}

// ── Agreement thresholds (match DashboardPage) ────────────────────────────────

const THRESHOLDS: Record<string, { warn: number; alert: number }> = {
  precip: { warn: 3, alert: 8 },
  wind_speed: { warn: 2, alert: 5 },
  mslp: { warn: 100, alert: 300 },
  hgt_500: { warn: 20, alert: 60 },
}

function agreementLevel(variable: string, spreadRaw: number): 'good' | 'warn' | 'alert' {
  const t = THRESHOLDS[variable]
  if (!t) return 'good'
  if (spreadRaw >= t.alert) return 'alert'
  if (spreadRaw >= t.warn) return 'warn'
  return 'good'
}

const AGREEMENT_BADGE: Record<string, { label: string; badgeClass: string }> = {
  good: { label: 'Models agree', badgeClass: 'badge-green' },
  warn: { label: 'Some disagreement', badgeClass: 'badge-yellow' },
  alert: { label: 'High uncertainty', badgeClass: 'badge-red' },
}

// ── Variable metadata ─────────────────────────────────────────────────────────

const VAR_META: Record<string, { icon: string; label: string; detail: string }> = {
  precip: {
    icon: 'M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z',
    label: 'Precipitation',
    detail: 'Total accumulated precip (rain + snow equivalent)',
  },
  wind_speed: {
    icon: 'M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z',
    label: 'Wind Speed',
    detail: '10-meter sustained wind speed',
  },
  mslp: {
    icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
    label: 'Air Pressure',
    detail: 'Mean sea-level pressure — lower means stormier',
  },
  hgt_500: {
    icon: 'M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
    label: 'Jet Stream Height',
    detail: '500 mb geopotential height — ridge (high/dry) vs. trough (low/wet)',
  },
}

const VARIABLES = ['precip', 'wind_speed', 'mslp', 'hgt_500']

// ── Per-variable card ─────────────────────────────────────────────────────────

interface VariableCardProps {
  variable: string
  rows: ModelPointValue[]
  index: number
}

function VariableCard({ variable, rows, index }: VariableCardProps) {
  const [expanded, setExpanded] = useState(true)
  const meta = VAR_META[variable]

  if (rows.length === 0) {
    return (
      <div className={`glass-card p-6 animate-slide-up delay-${index + 1}`}>
        <div className="mb-2 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
              strokeWidth={1.5} stroke="currentColor" className="w-5 h-5" style={{ color: 'var(--text-tertiary)' }}>
              <path strokeLinecap="round" strokeLinejoin="round" d={meta.icon} />
            </svg>
          </div>
          <span className="font-semibold" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-secondary)' }}>{meta.label}</span>
        </div>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No data available</p>
      </div>
    )
  }

  const rawValues = rows.map(r => r.value)
  const meanRaw = rawValues.reduce((a, b) => a + b, 0) / rawValues.length
  const minRaw = Math.min(...rawValues)
  const maxRaw = Math.max(...rawValues)
  const variance = rawValues.reduce((acc, v) => acc + (v - meanRaw) ** 2, 0) / rawValues.length
  const spreadRaw = Math.sqrt(variance)

  const meanFmt = formatValue(variable, meanRaw)
  const minFmt = formatValue(variable, minRaw)
  const maxFmt = formatValue(variable, maxRaw)
  const level = agreementLevel(variable, spreadRaw)
  const badge = AGREEMENT_BADGE[level]
  const consensusLabel = getLabel(variable, meanFmt.converted, meanFmt.display, meanFmt.unit)

  return (
    <div className={`glass-card p-6 flex flex-col gap-4 animate-slide-up delay-${index + 1}`}>
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ background: 'var(--accent-glow)', border: '1px solid var(--border-subtle)' }}>
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
            strokeWidth={1.5} stroke="currentColor" className="w-5 h-5" style={{ color: 'var(--accent)' }}>
            <path strokeLinecap="round" strokeLinejoin="round" d={meta.icon} />
          </svg>
        </div>
        <div>
          <div className="font-semibold" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
            {meta.label}
          </div>
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{meta.detail}</div>
        </div>
      </div>

      {/* Range + consensus summary */}
      <div>
        <p className="text-2xl font-bold tracking-tight" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
          {minFmt.display}–{maxFmt.display} <span className="text-base font-medium" style={{ color: 'var(--text-tertiary)' }}>{minFmt.unit}</span>
        </p>
        <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>{consensusLabel}</p>
      </div>

      {/* Agreement badge */}
      <span className={`badge w-fit ${badge.badgeClass}`}>
        {badge.label}
      </span>

      {/* Expandable model breakdown */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="flex items-center gap-1.5 text-xs font-medium self-start transition-colors"
        style={{ color: 'var(--accent)' }}
      >
        <span className="inline-block transition-transform duration-200" style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </span>
        {expanded ? 'Hide' : 'Show'} model breakdown
      </button>

      {expanded && (
        <div className="space-y-2.5 animate-slide-down">
          {rows
            .slice()
            .sort((a, b) => b.value - a.value)
            .map(row => {
              const fmt = formatValue(variable, row.value)
              const pct = maxRaw > minRaw
                ? ((row.value - minRaw) / (maxRaw - minRaw)) * 100
                : 50
              return (
                <div key={row.model_name} className="flex items-center gap-3">
                  <span className="w-14 shrink-0 text-xs font-mono" style={{ color: 'var(--text-tertiary)' }}>
                    {row.model_name}
                  </span>
                  <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--border-subtle)' }}>
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${Math.max(pct, 4)}%`,
                        background: 'linear-gradient(90deg, var(--accent-dim), var(--accent))',
                        boxShadow: '0 0 8px var(--accent-glow)',
                      }}
                    />
                  </div>
                  <span className="w-20 shrink-0 text-right text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                    {fmt.display} {fmt.unit}
                  </span>
                </div>
              )
            })}
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function OutlookPage() {
  const { data: monitorPoints = [] } = useMonitorPoints()
  const [locationParam, setLocationParam] = useUrlState('location', '')
  const [leadParam, setLeadParam] = useUrlState('lead', '12')

  const leadHour = parseInt(leadParam) || 12
  const setLeadHour = (v: number) => setLeadParam(String(v))

  const selectedIdx = (() => {
    if (!locationParam || monitorPoints.length === 0) return 0
    const idx = monitorPoints.findIndex(p => `${p.lat},${p.lon}` === locationParam)
    return idx >= 0 ? idx : 0
  })()

  const point = monitorPoints[selectedIdx]

  const { data: modelValues = [], isLoading, isError } = useModelValues({
    lat: point?.lat ?? 0,
    lon: point?.lon ?? 0,
    lead_hour: leadHour,
    enabled: !!point,
  })

  const byVariable: Record<string, ModelPointValue[]> = {}
  for (const v of VARIABLES) byVariable[v] = []
  for (const row of modelValues) {
    if (byVariable[row.variable]) byVariable[row.variable].push(row)
  }

  const initTime = modelValues[0]?.init_time
    ? new Date(modelValues[0].init_time).toUTCString().replace(':00 GMT', ' UTC')
    : null

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Page header */}
      <div className="animate-slide-up">
        <h1 className="section-title text-2xl" style={{ fontFamily: 'var(--font-display)' }}>Forecast Outlook</h1>
        <p className="section-subtitle mt-2">
          Plain-language summary of what each model is predicting — in everyday units.
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-end gap-5 animate-slide-up delay-1">
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-tertiary)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            Location
          </label>
          <select
            value={locationParam || (monitorPoints[0] ? `${monitorPoints[0].lat},${monitorPoints[0].lon}` : '')}
            onChange={e => setLocationParam(e.target.value)}
            className="control-select"
          >
            {monitorPoints.map(pt => (
              <option key={pt.label} value={`${pt.lat},${pt.lon}`}>{pt.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-tertiary)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            Forecast hour
          </label>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={0}
              max={120}
              step={6}
              value={leadHour}
              onChange={e => setLeadHour(Number(e.target.value))}
              className="w-40"
            />
            <span className="text-sm font-semibold min-w-[48px]" style={{ fontFamily: 'var(--font-display)', color: 'var(--accent)' }}>
              +{leadHour}h
            </span>
          </div>
        </div>
      </div>

      {/* Init time badge */}
      {initTime && (
        <p className="text-xs animate-fade-in" style={{ color: 'var(--text-muted)' }}>
          Model run initialized: <span style={{ color: 'var(--text-tertiary)' }}>{initTime}</span>
        </p>
      )}

      {/* State: loading */}
      {isLoading && (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={`skeleton-shimmer h-[200px] delay-${i + 1}`} />
          ))}
        </div>
      )}

      {/* State: error */}
      {isError && (
        <div className="glass-card p-5 text-sm animate-scale-in" style={{ borderColor: 'var(--red-border)', color: 'var(--red)' }}>
          Failed to load forecast data. Check that the backend is running.
        </div>
      )}

      {/* State: no data yet */}
      {!isLoading && !isError && modelValues.length === 0 && (
        <div className="glass-card p-10 text-center animate-scale-in">
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>No forecast data available for this location and lead hour yet.</p>
          <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
            Trigger a model ingestion run from the Admin panel, or wait for the next scheduled cycle.
          </p>
        </div>
      )}

      {/* Variable cards */}
      {!isLoading && modelValues.length > 0 && (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          {VARIABLES.map((v, i) => (
            <VariableCard key={v} variable={v} rows={byVariable[v]} index={i} />
          ))}
        </div>
      )}

      {/* Footer note */}
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        Precip values are water-equivalent (rain or snow). Wind speeds are 10-meter sustained.
        Pressure and jet-stream heights are averaged across models for the consensus estimate.
      </p>
    </div>
  )
}
