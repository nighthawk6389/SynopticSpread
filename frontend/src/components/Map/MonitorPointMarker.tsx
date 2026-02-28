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
          background:#2563EB;border:2px solid #FFFFFF;
          box-shadow:0 1px 4px rgba(0,0,0,0.2);
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
          <p className="font-bold mb-1" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>{label}</p>
          <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
            {lat.toFixed(3)}, {lon.toFixed(3)}
          </p>
          {isLoading ? (
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Loading metrics…</p>
          ) : latest ? (
            <table className="w-full text-xs border-collapse">
              <tbody>
                {[
                  { label: 'Lead hour', value: `${latest.lead_hour}h` },
                  { label: 'Spread', value: `${latest.spread.toFixed(3)} ${unit}` },
                  { label: 'RMSE', value: `${latest.rmse.toFixed(3)} ${unit}` },
                  { label: 'Bias', value: `${latest.bias.toFixed(3)} ${unit}` },
                ].map(row => (
                  <tr key={row.label}>
                    <td className="pr-3 py-0.5" style={{ color: 'var(--text-tertiary)' }}>{row.label}</td>
                    <td className="font-medium" style={{ color: 'var(--text-primary)' }}>{row.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>No data for {variable} at {leadHour}h.</p>
          )}
        </div>
      </Popup>
    </Marker>
  )
}
