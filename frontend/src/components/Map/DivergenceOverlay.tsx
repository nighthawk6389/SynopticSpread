import L from 'leaflet'
import { useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'
import type { GridDivergenceData } from '../../api/client'

interface Props {
  data: GridDivergenceData
}

function valueToColor(value: number, min: number, max: number): string {
  const t = max === min ? 0 : (value - min) / (max - min)
  // Green (low divergence) → Yellow → Red (high divergence)
  const r = Math.round(255 * Math.min(1, t * 2))
  const g = Math.round(255 * Math.min(1, 2 - t * 2))
  return `rgba(${r},${g},0,0.55)`
}

export default function DivergenceOverlay({ data }: Props) {
  const map = useMap()
  const layerRef = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (layerRef.current) {
      layerRef.current.clearLayers()
      map.removeLayer(layerRef.current)
    }

    const group = L.layerGroup()
    layerRef.current = group

    const { latitudes, longitudes, values } = data
    if (!latitudes.length || !longitudes.length || !values.length) return

    // Find min/max for color scaling
    let min = Infinity
    let max = -Infinity
    for (const row of values) {
      for (const v of row) {
        if (isFinite(v)) {
          if (v < min) min = v
          if (v > max) max = v
        }
      }
    }

    const latStep = latitudes.length > 1 ? Math.abs(latitudes[1] - latitudes[0]) : 0.25
    const lonStep = longitudes.length > 1 ? Math.abs(longitudes[1] - longitudes[0]) : 0.25

    for (let i = 0; i < latitudes.length; i++) {
      for (let j = 0; j < longitudes.length; j++) {
        const val = values[i]?.[j]
        if (val === undefined || !isFinite(val)) continue

        const bounds: L.LatLngBoundsExpression = [
          [latitudes[i] - latStep / 2, longitudes[j] - lonStep / 2],
          [latitudes[i] + latStep / 2, longitudes[j] + lonStep / 2],
        ]

        L.rectangle(bounds, {
          color: 'transparent',
          fillColor: valueToColor(val, min, max),
          fillOpacity: 0.6,
          weight: 0,
        }).addTo(group)
      }
    }

    group.addTo(map)

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current)
      }
    }
  }, [data, map])

  return null
}
