import { useQuery } from '@tanstack/react-query'
import axios from 'axios'

const api = axios.create({ baseURL: '/api' })

// Types
export interface ModelRun {
  id: string
  model_name: string
  init_time: string
  forecast_hours: number[]
  status: string
  created_at: string
}

export interface PointMetric {
  id: string
  run_a_id: string
  run_b_id: string
  variable: string
  lat: number
  lon: number
  lead_hour: number
  rmse: number
  bias: number
  spread: number
  created_at: string
}

export interface GridDivergenceData {
  variable: string
  lead_hour: number
  init_time: string
  latitudes: number[]
  longitudes: number[]
  values: number[][]
  bbox: { min_lat: number; max_lat: number; min_lon: number; max_lon: number }
}

export interface DivergenceSummary {
  variable: string
  mean_spread: number
  max_spread: number
  min_spread: number
  num_points: number
  models_compared: string[]
  init_time: string
}

export interface GridSnapshot {
  id: string
  init_time: string
  variable: string
  lead_hour: number
  bbox: Record<string, number>
  created_at: string
}

export interface MonitorPoint {
  lat: number
  lon: number
  label: string
}

// Hooks
export function useRuns(modelName?: string) {
  return useQuery({
    queryKey: ['runs', modelName],
    queryFn: () =>
      api.get<ModelRun[]>('/runs', { params: { model_name: modelName } }).then(r => r.data),
  })
}

export function useVariables() {
  return useQuery({
    queryKey: ['variables'],
    queryFn: () => api.get<Record<string, string>>('/variables').then(r => r.data),
  })
}

export function useMonitorPoints() {
  return useQuery({
    queryKey: ['monitor-points'],
    queryFn: () => api.get<MonitorPoint[]>('/monitor-points').then(r => r.data),
    staleTime: Infinity,
  })
}

export function useDivergencePoint(params: {
  lat: number
  lon: number
  variable: string
  lead_hour?: number
  enabled?: boolean
}) {
  const { enabled = true, ...queryParams } = params
  return useQuery({
    queryKey: ['divergence-point', queryParams],
    queryFn: () => api.get<PointMetric[]>('/divergence/point', { params: queryParams }).then(r => r.data),
    enabled: enabled && !!queryParams.lat && !!queryParams.lon && !!queryParams.variable,
  })
}

export function useDivergenceGrid(params: {
  variable: string
  lead_hour: number
}) {
  return useQuery({
    queryKey: ['divergence-grid', params],
    queryFn: () => api.get<GridDivergenceData>('/divergence/grid', { params }).then(r => r.data),
  })
}

export function useDivergenceSummary() {
  return useQuery({
    queryKey: ['divergence-summary'],
    queryFn: () => api.get<DivergenceSummary[]>('/divergence/summary').then(r => r.data),
  })
}

export function useGridSnapshots(variable?: string) {
  return useQuery({
    queryKey: ['grid-snapshots', variable],
    queryFn: () =>
      api.get<GridSnapshot[]>('/divergence/grid/snapshots', { params: { variable } }).then(r => r.data),
  })
}

export function useRunMetrics(runId: string | null) {
  return useQuery({
    queryKey: ['run-metrics', runId],
    queryFn: () => api.get<PointMetric[]>(`/runs/${runId}/metrics`).then(r => r.data),
    enabled: !!runId,
  })
}
