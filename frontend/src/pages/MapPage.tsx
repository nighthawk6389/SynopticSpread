import 'leaflet/dist/leaflet.css'
import { useCallback, useMemo, useState } from 'react'
import { MapContainer, TileLayer, useMapEvents } from 'react-leaflet'
import { useDivergenceGrid, useDivergencePoint } from '../api/client'
import DivergenceOverlay from '../components/Map/DivergenceOverlay'
import PointPopup from '../components/Map/PointPopup'

const VARIABLES = [
  { value: 'precip', label: 'Precipitation' },
  { value: 'wind_speed', label: 'Wind Speed' },
  { value: 'mslp', label: 'Sea-Level Pressure' },
  { value: 'hgt_500', label: '500mb Heights' },
]

function MapClickHandler({ onClick }: { onClick: (lat: number, lon: number) => void }) {
  useMapEvents({
    click(e) {
      onClick(e.latlng.lat, e.latlng.lng)
    },
  })
  return null
}

export default function MapPage() {
  const [variable, setVariable] = useState('precip')
  const [leadHour, setLeadHour] = useState(0)
  const [selectedPoint, setSelectedPoint] = useState<{ lat: number; lon: number } | null>(null)

  const { data: gridData, isLoading } = useDivergenceGrid({ variable, lead_hour: leadHour })
  const { data: pointData } = useDivergencePoint({
    lat: selectedPoint?.lat ?? 0,
    lon: selectedPoint?.lon ?? 0,
    variable,
    lead_hour: leadHour,
  })

  const handleMapClick = useCallback((lat: number, lon: number) => {
    setSelectedPoint({ lat, lon })
  }, [])

  const center = useMemo<[number, number]>(() => {
    if (gridData?.bbox) {
      return [
        (gridData.bbox.min_lat + gridData.bbox.max_lat) / 2,
        (gridData.bbox.min_lon + gridData.bbox.max_lon) / 2,
      ]
    }
    return [39.8, -98.5] // center of CONUS
  }, [gridData])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
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
          <label className="block text-xs text-gray-400 mb-1">Lead Hour</label>
          <input
            type="range"
            min={0}
            max={120}
            step={6}
            value={leadHour}
            onChange={e => setLeadHour(Number(e.target.value))}
            className="w-48"
          />
          <span className="ml-2 text-sm text-gray-400">{leadHour}h</span>
        </div>
        {isLoading && <span className="text-sm text-gray-500">Loading grid...</span>}
      </div>

      <div className="h-[600px] rounded-lg overflow-hidden border border-gray-700">
        <MapContainer center={center} zoom={4} className="h-full w-full">
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          />
          <MapClickHandler onClick={handleMapClick} />
          {gridData && <DivergenceOverlay data={gridData} />}
          {selectedPoint && pointData && (
            <PointPopup lat={selectedPoint.lat} lon={selectedPoint.lon} metrics={pointData} />
          )}
        </MapContainer>
      </div>

      <p className="text-xs text-gray-500">
        Click anywhere on the map to view point-level divergence metrics.
      </p>
    </div>
  )
}
