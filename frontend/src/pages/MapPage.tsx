import 'leaflet/dist/leaflet.css'
import { useState } from 'react'
import { MapContainer, TileLayer } from 'react-leaflet'
import { useDivergenceGrid, useMonitorPoints, useRegionalDivergence } from '../api/client'
import ClickTooltip from '../components/ClickTooltip'
import DivergenceOverlay from '../components/Map/DivergenceOverlay'
import MonitorPointMarker from '../components/Map/MonitorPointMarker'
import PlaybackControls from '../components/Map/PlaybackControls'
import RegionalOverlay from '../components/Map/RegionalOverlay'
import VoronoiOverlay from '../components/Map/VoronoiOverlay'

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
  const [overlayMode, setOverlayMode] = useState<'grid' | 'regions' | 'voronoi'>('grid')
  const [colorBy, setColorBy] = useState<'spread' | 'rmse' | 'bias'>('spread')

  const { data: gridData, isLoading } = useDivergenceGrid({ variable, lead_hour: leadHour })
  const { data: monitorPoints } = useMonitorPoints()
  const { data: regionalData } = useRegionalDivergence({ variable, lead_hour: leadHour })

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
            <ClickTooltip>
              <p className="font-semibold text-white mb-1">What is a lead hour?</p>
              <p className="mb-2">{LEAD_HOUR_INFO}</p>
              <p className="text-gray-400">
                <strong>0h</strong> = now, <strong>6h</strong> = 6 hours out,{' '}
                <strong>24h</strong> = tomorrow, <strong>120h</strong> = 5 days.
              </p>
            </ClickTooltip>
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

        {/* Overlay mode */}
        <div>
          <label className="block text-xs text-gray-400 mb-1">Overlay</label>
          <select
            value={overlayMode}
            onChange={e => setOverlayMode(e.target.value as 'grid' | 'regions' | 'voronoi')}
            className="rounded bg-gray-800 border border-gray-700 px-3 py-1.5 text-sm"
          >
            <option value="grid">Grid Cells</option>
            <option value="regions">Regions</option>
            <option value="voronoi">Voronoi</option>
          </select>
        </div>

        {/* Color-by selector (regions/voronoi mode) */}
        {(overlayMode === 'regions' || overlayMode === 'voronoi') && (
          <div>
            <label className="block text-xs text-gray-400 mb-1">Color by</label>
            <select
              value={colorBy}
              onChange={e => setColorBy(e.target.value as 'spread' | 'rmse' | 'bias')}
              className="rounded bg-gray-800 border border-gray-700 px-3 py-1.5 text-sm"
            >
              <option value="spread">Spread</option>
              <option value="rmse">RMSE</option>
              <option value="bias">Bias</option>
            </select>
          </div>
        )}

        {isLoading && <span className="text-sm text-gray-500 self-center">Loading grid…</span>}
      </div>

      {/* Playback controls */}
      <div className="max-w-md">
        <PlaybackControls
          leadHour={leadHour}
          setLeadHour={setLeadHour}
          min={0}
          max={120}
          step={6}
        />
      </div>

      <div className="h-[600px] rounded-lg overflow-hidden border border-gray-700">
        <MapContainer center={[39.8, -98.5]} zoom={4} className="h-full w-full">
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          />
          {overlayMode === 'grid' && gridData && <DivergenceOverlay data={gridData} />}
          {overlayMode === 'regions' && regionalData && (
            <RegionalOverlay data={regionalData} metric={colorBy} />
          )}
          {overlayMode === 'voronoi' && regionalData && (
            <VoronoiOverlay data={regionalData} metric={colorBy} />
          )}
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
        Color: green = low divergence, red = high divergence.
      </p>
    </div>
  )
}
