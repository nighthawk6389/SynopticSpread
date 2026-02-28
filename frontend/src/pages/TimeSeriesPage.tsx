import { useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useDecomposition, useDivergencePoint, useVerificationScores } from '../api/client'
import { useUrlState } from '../hooks/useUrlState'

const VARIABLES = [
  { value: 'precip', label: 'Precipitation' },
  { value: 'wind_speed', label: 'Wind Speed' },
  { value: 'mslp', label: 'Sea-Level Pressure' },
  { value: 'hgt_500', label: '500mb Heights' },
]

const VARIABLE_UNITS: Record<string, string> = {
  precip: 'mm',
  wind_speed: 'm/s',
  mslp: 'Pa',
  hgt_500: 'm',
}

const PRESET_LOCATIONS = [
  { lat: 40.7128, lon: -74.006, label: 'New York' },
  { lat: 34.0522, lon: -118.2437, label: 'Los Angeles' },
  { lat: 41.8781, lon: -87.6298, label: 'Chicago' },
  { lat: 29.7604, lon: -95.3698, label: 'Houston' },
  { lat: 47.6062, lon: -122.3321, label: 'Seattle' },
  { lat: 39.7392, lon: -104.9903, label: 'Denver' },
  { lat: 25.7617, lon: -80.1918, label: 'Miami' },
  { lat: 38.9072, lon: -77.0369, label: 'Washington DC' },
  { lat: 33.749, lon: -84.388, label: 'Atlanta' },
  { lat: 42.3601, lon: -71.0589, label: 'Boston' },
  { lat: 44.9778, lon: -93.265, label: 'Minneapolis' },
  { lat: 33.4484, lon: -112.074, label: 'Phoenix' },
  { lat: 37.7749, lon: -122.4194, label: 'San Francisco' },
  { lat: 32.7767, lon: -96.797, label: 'Dallas' },
  { lat: 45.5155, lon: -122.6789, label: 'Portland' },
  { lat: 42.3314, lon: -83.0458, label: 'Detroit' },
  { lat: 36.1627, lon: -86.7816, label: 'Nashville' },
  { lat: 39.9612, lon: -82.9988, label: 'Columbus' },
  { lat: 35.2271, lon: -80.8431, label: 'Charlotte' },
  { lat: 32.7157, lon: -117.1611, label: 'San Diego' },
]

const COLORS = ['#22d3ee', '#f87171', '#34d399', '#fbbf24', '#a78bfa', '#fb923c']

const MODEL_COLORS: Record<string, string> = {
  GFS: '#22d3ee',
  NAM: '#f87171',
  ECMWF: '#34d399',
  HRRR: '#fbbf24',
  AIGFS: '#e879f9',
  RRFS: '#2dd4bf',
}

const PAIR_COLORS: Record<string, string> = {
  'ECMWF-GFS': '#22d3ee',
  'GFS-NAM': '#f87171',
  'ECMWF-NAM': '#34d399',
  'GFS-HRRR': '#fbbf24',
  'ECMWF-HRRR': '#a78bfa',
  'HRRR-NAM': '#fb923c',
  'AIGFS-GFS': '#e879f9',
  'AIGFS-NAM': '#c084fc',
  'AIGFS-ECMWF': '#f0abfc',
  'AIGFS-HRRR': '#d946ef',
  'AIGFS-RRFS': '#a855f7',
  'GFS-RRFS': '#2dd4bf',
  'NAM-RRFS': '#5eead4',
  'ECMWF-RRFS': '#14b8a6',
  'HRRR-RRFS': '#99f6e4',
}

const PAIR_DASHES: Record<string, string> = {
  'ECMWF-GFS': '',
  'GFS-NAM': '8 4',
  'ECMWF-NAM': '4 4',
  'GFS-HRRR': '12 4',
  'ECMWF-HRRR': '4 2 4 2',
  'HRRR-NAM': '8 2 2 2',
  'AIGFS-GFS': '2 2',
  'AIGFS-NAM': '6 3',
  'AIGFS-ECMWF': '10 3',
  'AIGFS-HRRR': '4 4 2 4',
  'AIGFS-RRFS': '8 2 4 2',
  'GFS-RRFS': '6 2 2 2',
  'NAM-RRFS': '10 2 2 2',
  'ECMWF-RRFS': '4 2',
  'HRRR-RRFS': '6 6',
}

export default function TimeSeriesPage() {
  const [variable, setVariable] = useUrlState('var', 'precip')
  const [locParam, setLocParam] = useUrlState('loc', `${PRESET_LOCATIONS[0].lat},${PRESET_LOCATIONS[0].lon}`)
  const [viewMode, setViewMode] = useUrlState('view', 'aggregate')

  const location = (() => {
    const parts = locParam.split(',')
    if (parts.length === 2) {
      const lat = parseFloat(parts[0])
      const lon = parseFloat(parts[1])
      if (!isNaN(lat) && !isNaN(lon)) {
        const preset = PRESET_LOCATIONS.find(l => l.lat === lat && l.lon === lon)
        return { lat, lon, label: preset?.label ?? `${lat.toFixed(2)}, ${lon.toFixed(2)}` }
      }
    }
    return PRESET_LOCATIONS[0]
  })()

  const [customLat, setCustomLat] = useState('')
  const [customLon, setCustomLon] = useState('')

  const { data: metrics, isLoading } = useDivergencePoint({
    lat: location.lat,
    lon: location.lon,
    variable,
  })

  const { data: decomposition, isLoading: decompLoading } = useDecomposition({
    variable,
    lat: location.lat,
    lon: location.lon,
    enabled: viewMode === 'decomposition',
  })

  const { data: verification, isLoading: verificationLoading } = useVerificationScores({
    variable,
    lat: location.lat,
    lon: location.lon,
    enabled: viewMode === 'verification',
  })

  const chartData = (() => {
    if (!metrics || metrics.length === 0) return []
    const byHour = new Map<number, Record<string, number>>()
    for (const m of metrics) {
      if (!byHour.has(m.lead_hour)) {
        byHour.set(m.lead_hour, {
          lead_hour: m.lead_hour,
          spread: m.spread,
          rmse: m.rmse,
          bias: m.bias,
        })
      }
    }
    return Array.from(byHour.values()).sort((a, b) => a.lead_hour - b.lead_hour)
  })()

  const decompChartData = (() => {
    if (!decomposition || decomposition.length === 0) return { data: [] as Record<string, number>[], pairs: [] as string[] }
    const pairSet = new Set<string>()
    const data = decomposition.map(entry => {
      const row: Record<string, number> = { lead_hour: entry.lead_hour }
      for (const pair of entry.pairs) {
        const key = pair.model_a < pair.model_b
          ? `${pair.model_a}-${pair.model_b}`
          : `${pair.model_b}-${pair.model_a}`
        row[key] = pair.rmse
        pairSet.add(key)
      }
      return row
    })
    return { data, pairs: Array.from(pairSet).sort() }
  })()

  const verificationChartData = (() => {
    if (!verification || verification.scores.length === 0) return { data: [] as Record<string, number>[], models: [] as string[] }
    const modelSet = new Set<string>()
    const byHour: Record<number, Record<string, number>> = {}
    for (const s of verification.scores) {
      modelSet.add(s.model_name)
      if (!byHour[s.lead_hour]) byHour[s.lead_hour] = { lead_hour: s.lead_hour }
      byHour[s.lead_hour][`${s.model_name}_mae`] = s.mae
    }
    return {
      data: Object.values(byHour).sort((a, b) => a.lead_hour - b.lead_hour),
      models: Array.from(modelSet).sort(),
    }
  })()

  const handleCustomLocation = () => {
    const lat = parseFloat(customLat)
    const lon = parseFloat(customLon)
    if (!isNaN(lat) && !isNaN(lon)) {
      setLocParam(`${lat},${lon}`)
    }
  }

  const isChartLoading = viewMode === 'aggregate' ? isLoading : viewMode === 'decomposition' ? decompLoading : verificationLoading
  const hasData = viewMode === 'aggregate'
    ? chartData.length > 0
    : viewMode === 'decomposition'
      ? decompChartData.data.length > 0
      : verificationChartData.data.length > 0

  const tooltipStyle = {
    backgroundColor: 'var(--bg-surface)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 12,
    boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
  }

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="animate-slide-up">
        <h2 className="section-title text-2xl" style={{ fontFamily: 'var(--font-display)' }}>Time Series Analysis</h2>
        <p className="section-subtitle mt-2">
          Divergence metrics vs. forecast lead time
        </p>
      </div>

      {/* Controls */}
      <div className="glass-card p-5 animate-slide-up delay-1">
        <div className="flex flex-wrap items-end gap-5">
          <div>
            <label className="block text-xs font-medium mb-1.5"
              style={{ color: 'var(--text-tertiary)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              Variable
            </label>
            <select
              value={variable}
              onChange={e => setVariable(e.target.value)}
              className="control-select"
            >
              {VARIABLES.map(v => (
                <option key={v.value} value={v.value}>{v.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5"
              style={{ color: 'var(--text-tertiary)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              Location
            </label>
            <select
              value={`${location.lat},${location.lon}`}
              onChange={e => {
                setLocParam(e.target.value)
              }}
              className="control-select"
            >
              {PRESET_LOCATIONS.map(l => (
                <option key={l.label} value={`${l.lat},${l.lon}`}>{l.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5"
              style={{ color: 'var(--text-tertiary)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              View
            </label>
            <select
              value={viewMode}
              onChange={e => setViewMode(e.target.value)}
              className="control-select"
            >
              <option value="aggregate">Aggregate</option>
              <option value="decomposition">Per-Pair Decomposition</option>
              <option value="verification">Forecast Verification</option>
            </select>
          </div>

          <div className="flex items-end gap-2">
            <div>
              <label className="block text-xs font-medium mb-1.5"
                style={{ color: 'var(--text-tertiary)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                Lat
              </label>
              <input
                type="text"
                value={customLat}
                onChange={e => setCustomLat(e.target.value)}
                placeholder="40.71"
                className="control-input w-20"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5"
                style={{ color: 'var(--text-tertiary)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                Lon
              </label>
              <input
                type="text"
                value={customLon}
                onChange={e => setCustomLon(e.target.value)}
                placeholder="-74.01"
                className="control-input w-20"
              />
            </div>
            <button onClick={handleCustomLocation} className="btn-primary">
              Go
            </button>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="glass-card p-6 animate-slide-up delay-2">
        <h3 className="text-sm font-semibold mb-5" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-secondary)' }}>
          {viewMode === 'aggregate'
            ? `Divergence at ${location.label} — ${VARIABLES.find(v => v.value === variable)?.label}`
            : viewMode === 'decomposition'
              ? `Per-Pair RMSE at ${location.label} — ${VARIABLES.find(v => v.value === variable)?.label}`
              : `Forecast Verification at ${location.label} — ${VARIABLES.find(v => v.value === variable)?.label}`
          }
        </h3>

        {viewMode === 'verification' && (
          <p className="text-xs mb-4 px-3 py-2 rounded-lg" style={{ color: 'var(--text-muted)', background: 'rgba(255,255,255,0.02)' }}>
            Compares forecasts to the model's own analysis field (lead hour 0). MAE shown per model per lead hour.
          </p>
        )}

        {isChartLoading ? (
          <div className="flex h-[350px] items-center justify-center" style={{ color: 'var(--text-tertiary)' }}>
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
              Loading…
            </div>
          </div>
        ) : !hasData ? (
          <div className="flex h-[350px] items-center justify-center" style={{ color: 'var(--text-tertiary)' }}>
            {viewMode === 'verification'
              ? 'Insufficient verification data. Forecasts need matching analysis fields at the same valid time.'
              : 'No data available for this location and variable.'}
          </div>
        ) : viewMode === 'aggregate' ? (
          <ResponsiveContainer width="100%" height={350}>
            <LineChart data={chartData} margin={{ left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(56,103,187,0.12)" />
              <XAxis
                dataKey="lead_hour"
                stroke="var(--text-tertiary)"
                tick={{ fontSize: 11, fontFamily: 'var(--font-body)' }}
                label={{
                  value: 'Forecast Lead Hour (h)',
                  position: 'insideBottom',
                  offset: -5,
                  fill: 'var(--text-tertiary)',
                  fontSize: 11,
                  fontFamily: 'var(--font-body)',
                }}
              />
              <YAxis
                stroke="var(--text-tertiary)"
                tick={{ fontSize: 11, fontFamily: 'var(--font-body)' }}
                label={{
                  value: VARIABLE_UNITS[variable] ?? '',
                  angle: -90,
                  position: 'insideLeft',
                  fill: 'var(--text-tertiary)',
                  fontSize: 11,
                  fontFamily: 'var(--font-body)',
                }}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                labelStyle={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)', fontSize: 11 }}
                itemStyle={{ fontFamily: 'var(--font-body)', fontSize: 12 }}
                labelFormatter={v => `Lead hour: ${v}h`}
              />
              <Legend verticalAlign="top" height={36} wrapperStyle={{ fontFamily: 'var(--font-body)', fontSize: 12 }} />
              <Line type="monotone" dataKey="spread" stroke={COLORS[0]} name="Ensemble Spread" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="rmse" stroke={COLORS[1]} name="RMSE" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="bias" stroke={COLORS[2]} name="Bias" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : viewMode === 'decomposition' ? (
          <ResponsiveContainer width="100%" height={350}>
            <LineChart data={decompChartData.data} margin={{ left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(56,103,187,0.12)" />
              <XAxis
                dataKey="lead_hour"
                stroke="var(--text-tertiary)"
                tick={{ fontSize: 11, fontFamily: 'var(--font-body)' }}
                label={{
                  value: 'Forecast Lead Hour (h)',
                  position: 'insideBottom',
                  offset: -5,
                  fill: 'var(--text-tertiary)',
                  fontSize: 11,
                  fontFamily: 'var(--font-body)',
                }}
              />
              <YAxis
                stroke="var(--text-tertiary)"
                tick={{ fontSize: 11, fontFamily: 'var(--font-body)' }}
                label={{
                  value: `RMSE (${VARIABLE_UNITS[variable] ?? ''})`,
                  angle: -90,
                  position: 'insideLeft',
                  fill: 'var(--text-tertiary)',
                  fontSize: 11,
                  fontFamily: 'var(--font-body)',
                }}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                labelStyle={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)', fontSize: 11 }}
                itemStyle={{ fontFamily: 'var(--font-body)', fontSize: 12 }}
                labelFormatter={v => `Lead hour: ${v}h`}
              />
              <Legend verticalAlign="top" height={36} wrapperStyle={{ fontFamily: 'var(--font-body)', fontSize: 12 }} />
              {decompChartData.pairs.map((pair, i) => (
                <Line
                  key={pair}
                  type="monotone"
                  dataKey={pair}
                  stroke={PAIR_COLORS[pair] ?? COLORS[i % COLORS.length]}
                  strokeDasharray={PAIR_DASHES[pair] ?? ''}
                  name={pair}
                  strokeWidth={2}
                  dot={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <ResponsiveContainer width="100%" height={350}>
            <BarChart data={verificationChartData.data} margin={{ left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(56,103,187,0.12)" />
              <XAxis
                dataKey="lead_hour"
                stroke="var(--text-tertiary)"
                tick={{ fontSize: 11, fontFamily: 'var(--font-body)' }}
                label={{
                  value: 'Forecast Lead Hour (h)',
                  position: 'insideBottom',
                  offset: -5,
                  fill: 'var(--text-tertiary)',
                  fontSize: 11,
                  fontFamily: 'var(--font-body)',
                }}
              />
              <YAxis
                stroke="var(--text-tertiary)"
                tick={{ fontSize: 11, fontFamily: 'var(--font-body)' }}
                label={{
                  value: `MAE (${VARIABLE_UNITS[variable] ?? ''})`,
                  angle: -90,
                  position: 'insideLeft',
                  fill: 'var(--text-tertiary)',
                  fontSize: 11,
                  fontFamily: 'var(--font-body)',
                }}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                labelStyle={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)', fontSize: 11 }}
                itemStyle={{ fontFamily: 'var(--font-body)', fontSize: 12 }}
                labelFormatter={v => `Lead hour: ${v}h`}
              />
              <Legend verticalAlign="top" height={36} wrapperStyle={{ fontFamily: 'var(--font-body)', fontSize: 12 }} />
              {verificationChartData.models.map((model, i) => (
                <Bar
                  key={model}
                  dataKey={`${model}_mae`}
                  fill={MODEL_COLORS[model] ?? COLORS[i % COLORS.length]}
                  name={`${model} MAE`}
                  radius={[4, 4, 0, 0]}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
