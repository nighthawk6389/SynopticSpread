import { Marker, Popup } from 'react-leaflet'
import type { PointMetric } from '../../api/client'

interface Props {
  lat: number
  lon: number
  metrics: PointMetric[]
}

export default function PointPopup({ lat, lon, metrics }: Props) {
  if (metrics.length === 0) {
    return (
      <Marker position={[lat, lon]}>
        <Popup>
          <div className="text-sm">
            <p className="font-medium">
              {lat.toFixed(3)}, {lon.toFixed(3)}
            </p>
            <p className="text-gray-500">No divergence data at this location.</p>
          </div>
        </Popup>
      </Marker>
    )
  }

  const latest = metrics[0]

  return (
    <Marker position={[lat, lon]}>
      <Popup>
        <div className="text-sm space-y-1">
          <p className="font-medium">
            {lat.toFixed(3)}, {lon.toFixed(3)}
          </p>
          <p>Variable: {latest.variable}</p>
          <p>Lead hour: {latest.lead_hour}h</p>
          <p>Spread: {latest.spread.toFixed(4)}</p>
          <p>RMSE: {latest.rmse.toFixed(4)}</p>
          <p>Bias: {latest.bias.toFixed(4)}</p>
        </div>
      </Popup>
    </Marker>
  )
}
