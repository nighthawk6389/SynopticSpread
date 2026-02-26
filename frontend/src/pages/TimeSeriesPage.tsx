import { useState } from 'react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useDivergencePoint } from '../api/client'

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
]

const COLORS = ['#60a5fa', '#f87171', '#34d399', '#fbbf24', '#a78bfa', '#fb923c']

export default function TimeSeriesPage() {
  const [variable, setVariable] = useState('precip')
  const [location, setLocation] = useState(PRESET_LOCATIONS[0])
  const [customLat, setCustomLat] = useState('')
  const [customLon, setCustomLon] = useState('')

  const { data: metrics, isLoading } = useDivergencePoint({
    lat: location.lat,
    lon: location.lon,
    variable,
  })

  // Transform metrics into chart data grouped by lead_hour.
  // Data arrives ordered by created_at DESC; keep the first (newest) entry per lead_hour.
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

  const handleCustomLocation = () => {
    const lat = parseFloat(customLat)
    const lon = parseFloat(customLon)
    if (!isNaN(lat) && !isNaN(lon)) {
      setLocation({ lat, lon, label: `${lat.toFixed(2)}, ${lon.toFixed(2)}` })
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Time Series Analysis</h2>
        <p className="mt-1 text-sm text-gray-400">
          Divergence metrics vs. forecast lead time
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Variable</label>
          <select
            value={variable}
            onChange={e => setVariable(e.target.value)}
            className="rounded bg-gray-800 border border-gray-700 px-3 py-1.5 text-sm"
          >
            {VARIABLES.map(v => (
              <option key={v.value} value={v.value}>{v.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">Location</label>
          <select
            value={`${location.lat},${location.lon}`}
            onChange={e => {
              const loc = PRESET_LOCATIONS.find(l => `${l.lat},${l.lon}` === e.target.value)
              if (loc) setLocation(loc)
            }}
            className="rounded bg-gray-800 border border-gray-700 px-3 py-1.5 text-sm"
          >
            {PRESET_LOCATIONS.map(l => (
              <option key={l.label} value={`${l.lat},${l.lon}`}>{l.label}</option>
            ))}
          </select>
        </div>

        <div className="flex items-end gap-2">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Lat</label>
            <input
              type="text"
              value={customLat}
              onChange={e => setCustomLat(e.target.value)}
              placeholder="40.71"
              className="w-20 rounded bg-gray-800 border border-gray-700 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Lon</label>
            <input
              type="text"
              value={customLon}
              onChange={e => setCustomLon(e.target.value)}
              placeholder="-74.01"
              className="w-20 rounded bg-gray-800 border border-gray-700 px-2 py-1.5 text-sm"
            />
          </div>
          <button
            onClick={handleCustomLocation}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium hover:bg-blue-500"
          >
            Go
          </button>
        </div>
      </div>

      <div className="rounded-lg bg-gray-800 border border-gray-700 p-4">
        <h3 className="text-sm font-medium text-gray-300 mb-4">
          Divergence at {location.label} — {VARIABLES.find(v => v.value === variable)?.label}
        </h3>
        {isLoading ? (
          <div className="flex h-64 items-center justify-center text-gray-500">Loading...</div>
        ) : chartData.length === 0 ? (
          <div className="flex h-64 items-center justify-center text-gray-500">
            No data available for this location and variable.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={350}>
            <LineChart data={chartData} margin={{ left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis
                dataKey="lead_hour"
                stroke="#9ca3af"
                label={{
                  value: 'Forecast Lead Hour (h)',
                  position: 'insideBottom',
                  offset: -5,
                  fill: '#9ca3af',
                  fontSize: 12,
                }}
              />
              <YAxis
                stroke="#9ca3af"
                label={{
                  value: VARIABLE_UNITS[variable] ?? '',
                  angle: -90,
                  position: 'insideLeft',
                  fill: '#9ca3af',
                  fontSize: 12,
                }}
              />
              <Tooltip
                contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: 8 }}
                labelStyle={{ color: '#9ca3af' }}
                labelFormatter={v => `Lead hour: ${v}h`}
              />
              <Legend verticalAlign="top" height={36} />
              <Line
                type="monotone"
                dataKey="spread"
                stroke={COLORS[0]}
                name="Ensemble Spread"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="rmse"
                stroke={COLORS[1]}
                name="RMSE"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="bias"
                stroke={COLORS[2]}
                name="Bias"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
