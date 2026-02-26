import 'leaflet/dist/leaflet.css'
import { useState } from 'react'
import { MapContainer, TileLayer } from 'react-leaflet'
import { useDivergenceGrid, useMonitorPoints } from '../api/client'
import DivergenceOverlay from '../components/Map/DivergenceOverlay'
import MonitorPointMarker from '../components/Map/MonitorPointMarker'

const VARIABLES = [
  { value: 'precip', label: 'Precipitation' },
  { value: 'wind_speed', label: 'Wind Speed' },
  { value: 'mslp', label: 'Sea-Level Pressure' },
  { value: 'hgt_500', label: '500mb Heights' },
]

const LEAD_HOUR_INFO =
  "Lead time is how many hours ahead of the model's initialization the forecast is valid. " +
  '0h = analysis time; 24h = tomorrow; 120h = 5 days out. ' +
  'Models typically diverge more at longer lead times as small atmospheric differences amplify.'

export default function MapPage() {
  const [variable, setVariable] = useState('precip')
  const [leadHour, setLeadHour] = useState(6)

  const { data: gridData, isLoading } = useDivergenceGrid({ variable, lead_hour: leadHour })
  const { data: monitorPoints } = useMonitorPoints()

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        {/* Variable selector */}
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

        {/* Lead hour slider with info tooltip */}
        <div>
          <div className="flex items-center gap-1 mb-1">
            <label className="text-xs text-gray-400">Lead Hour</label>
            <span
              className="relative group cursor-help"
              title={LEAD_HOUR_INFO}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="w-3.5 h-3.5 text-gray-500 hover:text-gray-300"
              >
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM9 9a1 1 0 112 0v5a1 1 0 11-2 0V9zm1-4a1 1 0 100 2 1 1 0 000-2z"
                  clipRule="evenodd"
                />
              </svg>
              {/* Rich tooltip panel */}
              <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 z-50 hidden group-hover:block w-72 rounded bg-gray-700 text-gray-200 text-xs p-3 shadow-lg leading-relaxed pointer-events-none">
                <p className="font-semibold text-white mb-1">What is a lead hour?</p>
                {LEAD_HOUR_INFO}
              </div>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={120}
              step={6}
              value={leadHour}
              onChange={e => setLeadHour(Number(e.target.value))}
              className="w-48"
            />
            <span className="text-sm text-gray-300 w-12">{leadHour}h</span>
          </div>
        </div>

        {isLoading && <span className="text-sm text-gray-500 self-center">Loading grid…</span>}
      </div>

      <div className="h-[600px] rounded-lg overflow-hidden border border-gray-700">
        <MapContainer center={[39.8, -98.5]} zoom={4} className="h-full w-full">
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          />
          {gridData && <DivergenceOverlay data={gridData} />}
          {monitorPoints?.map(pt => (
            <MonitorPointMarker
              key={`${pt.lat},${pt.lon}`}
              lat={pt.lat}
              lon={pt.lon}
              label={pt.label}
              variable={variable}
              leadHour={leadHour}
            />
          ))}
        </MapContainer>
      </div>

      <p className="text-xs text-gray-500">
        Click a blue pin to view point-level divergence metrics for that city.
        Grid color: blue = low divergence, red = high divergence.
      </p>
    </div>
  )
}
