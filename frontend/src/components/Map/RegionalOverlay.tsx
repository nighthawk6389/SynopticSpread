import L from 'leaflet'
import { useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'
import type { RegionalDivergence } from '../../api/client'

interface Props {
  data: RegionalDivergence[]
  metric: 'spread' | 'rmse' | 'bias'
}

function metricToColor(value: number | null, min: number, max: number): string {
  if (value === null) return 'rgba(128,128,128,0.3)'
  const t = max === min ? 0 : (value - min) / (max - min)
  // Green (low) → Yellow → Red (high)
  const r = Math.round(255 * Math.min(1, t * 2))
  const g = Math.round(255 * Math.min(1, 2 - t * 2))
  return `rgba(${r},${g},0,0.35)`
}

export default function RegionalOverlay({ data, metric }: Props) {
  const map = useMap()
  const layerRef = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (layerRef.current) {
      layerRef.current.clearLayers()
      map.removeLayer(layerRef.current)
    }

    const group = L.layerGroup()
    layerRef.current = group

    const values = data.map(d => d[metric]).filter((v): v is number => v !== null)
    const min = Math.min(...values, 0)
    const max = Math.max(...values, 1)

    for (const point of data) {
      const val = point[metric]
      L.circle([point.lat, point.lon], {
        radius: 300_000, // 300km
        color: 'transparent',
        fillColor: metricToColor(val, min, max),
        fillOpacity: 0.4,
        weight: 0,
      })
        .bindTooltip(
          `<strong>${point.label}</strong><br/>${metric}: ${val !== null ? val.toFixed(3) : 'N/A'}`,
        )
        .addTo(group)
    }

    group.addTo(map)

    return () => {
      if (layerRef.current) map.removeLayer(layerRef.current)
    }
  }, [data, metric, map])

  return null
}
