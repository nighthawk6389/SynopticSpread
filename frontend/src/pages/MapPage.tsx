import 'leaflet/dist/leaflet.css'
import { MapContainer, TileLayer } from 'react-leaflet'
import { useDivergenceGrid, useMonitorPoints, useRegionalDivergence } from '../api/client'
import ClickTooltip from '../components/ClickTooltip'
import DivergenceOverlay from '../components/Map/DivergenceOverlay'
import MonitorPointMarker from '../components/Map/MonitorPointMarker'
import PlaybackControls from '../components/Map/PlaybackControls'
import RegionalOverlay from '../components/Map/RegionalOverlay'
import VoronoiOverlay from '../components/Map/VoronoiOverlay'
import { useUrlState } from '../hooks/useUrlState'

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
  const [variable, setVariable] = useUrlState('var', 'precip')
  const [leadHourStr, setLeadHourStr] = useUrlState('lead', '6')
  const [overlayMode, setOverlayMode] = useUrlState('overlay', 'grid')
  const [colorBy, setColorBy] = useUrlState('color', 'spread')

  const leadHour = parseInt(leadHourStr) || 6
  const setLeadHour = (v: number | ((prev: number) => number)) => {
    if (typeof v === 'function') {
      setLeadHourStr(String(v(leadHour)))
    } else {
      setLeadHourStr(String(v))
    }
  }

  const { data: gridData, isLoading } = useDivergenceGrid({ variable, lead_hour: leadHour })
  const { data: monitorPoints } = useMonitorPoints()
  const { data: regionalData } = useRegionalDivergence({ variable, lead_hour: leadHour })

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="animate-slide-up">
        <h2 className="section-title text-2xl" style={{ fontFamily: 'var(--font-display)' }}>Divergence Map</h2>
        <p className="section-subtitle mt-2">
          Spatial visualization of model disagreement across CONUS.
        </p>
      </div>

      {/* Controls */}
      <div className="glass-card p-5 animate-slide-up delay-1">
        <div className="flex flex-wrap items-end gap-5">
          {/* Variable selector */}
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

          {/* Lead hour slider */}
          <div>
            <div className="flex items-center gap-1 mb-1.5">
              <label className="text-xs font-medium"
                style={{ color: 'var(--text-tertiary)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                Lead Hour
              </label>
              <ClickTooltip>
                <p className="font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>What is a lead hour?</p>
                <p className="mb-2" style={{ color: 'var(--text-secondary)' }}>{LEAD_HOUR_INFO}</p>
                <p style={{ color: 'var(--text-tertiary)' }}>
                  <strong>0h</strong> = now, <strong>6h</strong> = 6 hours out,{' '}
                  <strong>24h</strong> = tomorrow, <strong>120h</strong> = 5 days.
                </p>
              </ClickTooltip>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={120}
                step={6}
                value={leadHour}
                onChange={e => setLeadHour(Number(e.target.value))}
                className="w-48"
              />
              <span className="text-sm font-semibold min-w-[40px]"
                style={{ fontFamily: 'var(--font-display)', color: 'var(--accent)' }}>
                {leadHour}h
              </span>
            </div>
          </div>

          {/* Overlay mode */}
          <div>
            <label className="block text-xs font-medium mb-1.5"
              style={{ color: 'var(--text-tertiary)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              Overlay
            </label>
            <select
              value={overlayMode}
              onChange={e => setOverlayMode(e.target.value)}
              className="control-select"
            >
              <option value="grid">Grid Cells</option>
              <option value="regions">Regions</option>
              <option value="voronoi">Voronoi</option>
            </select>
          </div>

          {/* Color-by selector */}
          {(overlayMode === 'regions' || overlayMode === 'voronoi') && (
            <div>
              <label className="block text-xs font-medium mb-1.5"
                style={{ color: 'var(--text-tertiary)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                Color by
              </label>
              <select
                value={colorBy}
                onChange={e => setColorBy(e.target.value)}
                className="control-select"
              >
                <option value="spread">Spread</option>
                <option value="rmse">RMSE</option>
                <option value="bias">Bias</option>
              </select>
            </div>
          )}

          {isLoading && (
            <span className="text-xs self-center animate-pulse" style={{ color: 'var(--text-muted)' }}>
              Loading grid…
            </span>
          )}
        </div>

        {/* Playback controls */}
        <div className="mt-4 max-w-sm">
          <PlaybackControls
            leadHour={leadHour}
            setLeadHour={setLeadHour}
            min={0}
            max={120}
            step={6}
          />
        </div>
      </div>

      {/* Map */}
      <div className="animate-slide-up delay-2 overflow-hidden" style={{
        height: '620px',
        borderRadius: '16px',
        border: '1px solid var(--border-subtle)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
      }}>
        <MapContainer center={[39.8, -98.5]} zoom={4} className="h-full w-full">
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          />
          {overlayMode === 'grid' && gridData && <DivergenceOverlay data={gridData} />}
          {overlayMode === 'regions' && regionalData && (
            <RegionalOverlay data={regionalData} metric={colorBy as 'spread' | 'rmse' | 'bias'} />
          )}
          {overlayMode === 'voronoi' && regionalData && (
            <VoronoiOverlay data={regionalData} metric={colorBy as 'spread' | 'rmse' | 'bias'} />
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

      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        Click a blue pin to view point-level divergence metrics for that city.
        Color: green = low divergence, red = high divergence.
      </p>
    </div>
  )
}
