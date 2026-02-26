import { useState } from 'react'
import { type ModelPointValue, useModelValues, useMonitorPoints } from '../api/client'

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
  precip: { warn: 3, alert: 8 },       // mm
  wind_speed: { warn: 2, alert: 5 },   // m/s
  mslp: { warn: 100, alert: 300 },     // Pa
  hgt_500: { warn: 20, alert: 60 },    // m
}

function agreementLevel(variable: string, spreadRaw: number): 'good' | 'warn' | 'alert' {
  const t = THRESHOLDS[variable]
  if (!t) return 'good'
  if (spreadRaw >= t.alert) return 'alert'
  if (spreadRaw >= t.warn) return 'warn'
  return 'good'
}

const AGREEMENT_BADGE: Record<string, { label: string; classes: string }> = {
  good: { label: 'Models agree', classes: 'bg-green-900 text-green-300' },
  warn: { label: 'Some disagreement', classes: 'bg-yellow-900 text-yellow-300' },
  alert: { label: 'High uncertainty', classes: 'bg-red-900 text-red-300' },
}

// ── Variable metadata ─────────────────────────────────────────────────────────

const VAR_META: Record<string, { icon: string; label: string; detail: string }> = {
  precip: { icon: '🌧️', label: 'Precipitation', detail: 'Total accumulated precip (rain + snow equivalent)' },
  wind_speed: { icon: '💨', label: 'Wind Speed', detail: '10-meter sustained wind speed' },
  mslp: { icon: '🌡️', label: 'Air Pressure', detail: 'Mean sea-level pressure — lower means stormier' },
  hgt_500: { icon: '🌀', label: 'Jet Stream Height', detail: '500 mb geopotential height — ridge (high/dry) vs. trough (low/wet)' },
}

const VARIABLES = ['precip', 'wind_speed', 'mslp', 'hgt_500']

// ── Per-variable card ─────────────────────────────────────────────────────────

interface VariableCardProps {
  variable: string
  rows: ModelPointValue[]
}

function VariableCard({ variable, rows }: VariableCardProps) {
  const [expanded, setExpanded] = useState(false)
  const meta = VAR_META[variable]

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-gray-700 bg-gray-800 p-5">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-2xl">{meta.icon}</span>
          <span className="font-semibold text-gray-200">{meta.label}</span>
        </div>
        <p className="text-sm text-gray-500">No data available</p>
      </div>
    )
  }

  // Compute consensus stats from raw values
  const rawValues = rows.map(r => r.value)
  const meanRaw = rawValues.reduce((a, b) => a + b, 0) / rawValues.length
  const minRaw = Math.min(...rawValues)
  const maxRaw = Math.max(...rawValues)
  // Spread = std dev of raw values
  const variance = rawValues.reduce((acc, v) => acc + (v - meanRaw) ** 2, 0) / rawValues.length
  const spreadRaw = Math.sqrt(variance)

  const meanFmt = formatValue(variable, meanRaw)
  const minFmt = formatValue(variable, minRaw)
  const maxFmt = formatValue(variable, maxRaw)
  const level = agreementLevel(variable, spreadRaw)
  const badge = AGREEMENT_BADGE[level]
  const consensusLabel = getLabel(variable, meanFmt.converted, meanFmt.display, meanFmt.unit)

  return (
    <div className="rounded-xl border border-gray-700 bg-gray-800 p-5 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="text-2xl">{meta.icon}</span>
        <div>
          <div className="font-semibold text-gray-200">{meta.label}</div>
          <div className="text-xs text-gray-500">{meta.detail}</div>
        </div>
      </div>

      {/* Consensus summary */}
      <div>
        <p className="text-sm font-medium text-gray-100">{consensusLabel}</p>
        <p className="text-xs text-gray-400 mt-0.5">
          Range: {minFmt.display}–{maxFmt.display} {minFmt.unit}
        </p>
      </div>

      {/* Agreement badge */}
      <span className={`inline-flex w-fit items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.classes}`}>
        {badge.label}
      </span>

      {/* Expandable model breakdown */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors self-start"
      >
        <span className="inline-block transition-transform duration-200" style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>▾</span>
        {expanded ? 'Hide' : 'Show'} model breakdown
      </button>

      {expanded && (
        <div className="space-y-2">
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
                  <span className="w-14 shrink-0 text-xs font-mono text-gray-400">{row.model_name}</span>
                  <div className="flex-1 h-2 rounded-full bg-gray-700">
                    <div
                      className="h-2 rounded-full bg-blue-500"
                      style={{ width: `${Math.max(pct, 4)}%` }}
                    />
                  </div>
                  <span className="w-20 shrink-0 text-right text-xs text-gray-200">
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
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [leadHour, setLeadHour] = useState(12)

  const point = monitorPoints[selectedIdx]

  const { data: modelValues = [], isLoading, isError } = useModelValues({
    lat: point?.lat ?? 0,
    lon: point?.lon ?? 0,
    lead_hour: leadHour,
    enabled: !!point,
  })

  // Group model values by variable
  const byVariable: Record<string, ModelPointValue[]> = {}
  for (const v of VARIABLES) byVariable[v] = []
  for (const row of modelValues) {
    if (byVariable[row.variable]) byVariable[row.variable].push(row)
  }

  const initTime = modelValues[0]?.init_time
    ? new Date(modelValues[0].init_time).toUTCString().replace(':00 GMT', ' UTC')
    : null

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Forecast Outlook</h1>
        <p className="text-sm text-gray-400 mt-1">
          Plain-language summary of what each model is predicting — in everyday units.
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-400">Location</label>
          <select
            value={selectedIdx}
            onChange={e => setSelectedIdx(Number(e.target.value))}
            className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {monitorPoints.map((pt, i) => (
              <option key={pt.label} value={i}>{pt.label}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-3">
          <label className="text-sm text-gray-400">Forecast hour</label>
          <input
            type="range"
            min={0}
            max={120}
            step={6}
            value={leadHour}
            onChange={e => setLeadHour(Number(e.target.value))}
            className="w-40 accent-blue-500"
          />
          <span className="text-sm font-medium text-blue-400 w-12">+{leadHour}h</span>
        </div>
      </div>

      {/* Init time badge */}
      {initTime && (
        <p className="text-xs text-gray-500">
          Model run initialized: <span className="text-gray-400">{initTime}</span>
        </p>
      )}

      {/* State: loading */}
      {isLoading && (
        <div className="text-center py-12 text-gray-500">Loading forecast data…</div>
      )}

      {/* State: error */}
      {isError && (
        <div className="rounded-lg border border-red-800 bg-red-950 p-4 text-sm text-red-300">
          Failed to load forecast data. Check that the backend is running.
        </div>
      )}

      {/* State: no data yet */}
      {!isLoading && !isError && modelValues.length === 0 && (
        <div className="rounded-xl border border-gray-700 bg-gray-800 p-8 text-center">
          <p className="text-gray-400 text-sm">No forecast data available for this location and lead hour yet.</p>
          <p className="text-gray-500 text-xs mt-2">
            Trigger a model ingestion run from the Admin panel, or wait for the next scheduled cycle.
          </p>
        </div>
      )}

      {/* Variable cards (2-column grid) */}
      {!isLoading && modelValues.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {VARIABLES.map(v => (
            <VariableCard key={v} variable={v} rows={byVariable[v]} />
          ))}
        </div>
      )}

      {/* Footer note */}
      <p className="text-xs text-gray-600">
        Precip values are water-equivalent (rain or snow). Wind speeds are 10-meter sustained.
        Pressure and jet-stream heights are averaged across models for the consensus estimate.
      </p>
    </div>
  )
}
