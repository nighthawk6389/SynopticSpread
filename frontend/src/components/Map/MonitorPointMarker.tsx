import L from 'leaflet'
import { useMemo, useState } from 'react'
import { Marker, Popup } from 'react-leaflet'
import { useDivergencePoint } from '../../api/client'

const VARIABLE_UNITS: Record<string, string> = {
  precip: 'mm',
  wind_speed: 'm/s',
  mslp: 'Pa',
  hgt_500: 'm',
}

interface Props {
  lat: number
  lon: number
  label: string
  variable: string
  leadHour: number
}

export default function MonitorPointMarker({ lat, lon, label, variable, leadHour }: Props) {
  const [open, setOpen] = useState(false)

  const { data: metrics, isLoading } = useDivergencePoint({
    lat,
    lon,
    variable,
    lead_hour: leadHour,
    enabled: open,
  })

  const icon = useMemo(
    () =>
      L.divIcon({
        className: '',
        html: `<div style="
          width:14px;height:14px;border-radius:50%;
          background:#3b82f6;border:2px solid #fff;
          box-shadow:0 0 6px rgba(59,130,246,0.8);
          cursor:pointer;
        "></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
        popupAnchor: [0, -10],
      }),
    [],
  )

  const latest = metrics?.[0]
  const unit = VARIABLE_UNITS[variable] ?? ''

  return (
    <Marker
      position={[lat, lon]}
      icon={icon}
      eventHandlers={{ click: () => setOpen(true) }}
    >
      <Popup eventHandlers={{ remove: () => setOpen(false) }}>
        <div className="text-sm min-w-[160px]">
          <p className="font-bold text-gray-900 mb-1">{label}</p>
          <p className="text-xs text-gray-500 mb-2">
            {lat.toFixed(3)}, {lon.toFixed(3)}
          </p>
          {isLoading ? (
            <p className="text-gray-500 text-xs">Loading metrics…</p>
          ) : latest ? (
            <table className="w-full text-xs border-collapse">
              <tbody>
                <tr>
                  <td className="pr-3 text-gray-500 py-0.5">Lead hour</td>
                  <td className="font-medium">{latest.lead_hour}h</td>
                </tr>
                <tr>
                  <td className="pr-3 text-gray-500 py-0.5">Spread</td>
                  <td className="font-medium">{latest.spread.toFixed(3)} {unit}</td>
                </tr>
                <tr>
                  <td className="pr-3 text-gray-500 py-0.5">RMSE</td>
                  <td className="font-medium">{latest.rmse.toFixed(3)} {unit}</td>
                </tr>
                <tr>
                  <td className="pr-3 text-gray-500 py-0.5">Bias</td>
                  <td className="font-medium">{latest.bias.toFixed(3)} {unit}</td>
                </tr>
              </tbody>
            </table>
          ) : (
            <p className="text-gray-400 text-xs">No data for {variable} at {leadHour}h.</p>
          )}
        </div>
      </Popup>
    </Marker>
  )
}
