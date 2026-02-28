import { Delaunay } from 'd3-delaunay'
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
  // Green (low) -> Yellow -> Red (high)
  const r = Math.round(255 * Math.min(1, t * 2))
  const g = Math.round(255 * Math.min(1, 2 - t * 2))
  return `rgba(${r},${g},0,0.35)`
}

// CONUS bounding box for Voronoi clipping
const CONUS_BOUNDS: [number, number, number, number] = [-130, 24, -65, 50]

export default function VoronoiOverlay({ data, metric }: Props) {
  const map = useMap()
  const layerRef = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (layerRef.current) {
      layerRef.current.clearLayers()
      map.removeLayer(layerRef.current)
    }

    const group = L.layerGroup()
    layerRef.current = group

    if (data.length < 2) {
      group.addTo(map)
      return
    }

    // d3-delaunay uses [x, y] = [lon, lat]
    const points: [number, number][] = data.map(d => [d.lon, d.lat])
    const delaunay = Delaunay.from(points)
    const voronoi = delaunay.voronoi(CONUS_BOUNDS)

    const values = data.map(d => d[metric]).filter((v): v is number => v !== null)
    const min = Math.min(...values, 0)
    const max = Math.max(...values, 1)

    for (let i = 0; i < data.length; i++) {
      const cell = voronoi.cellPolygon(i)
      if (!cell) continue

      const point = data[i]
      const val = point[metric]

      // Convert [lon, lat] polygon to Leaflet [lat, lon]
      const latlngs: L.LatLngExpression[] = cell.map(([lon, lat]) => [lat, lon] as [number, number])

      L.polygon(latlngs, {
        color: 'rgba(0,0,0,0.15)',
        fillColor: metricToColor(val, min, max),
        fillOpacity: 0.4,
        weight: 1,
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
