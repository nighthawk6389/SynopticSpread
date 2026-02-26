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

export function useDivergenceSummary(params?: { lat?: number; lon?: number }) {
  return useQuery({
    queryKey: ['divergence-summary', params?.lat, params?.lon],
    queryFn: () => api.get<DivergenceSummary[]>('/divergence/summary', { params }).then(r => r.data),
  })
}

export function useGridSnapshots(variable?: string) {
  return useQuery({
    queryKey: ['grid-snapshots', variable],
    queryFn: () =>
      api.get<GridSnapshot[]>('/divergence/grid/snapshots', { params: { variable } }).then(r => r.data),
  })
}

export interface RegionalDivergence {
  lat: number
  lon: number
  label: string
  spread: number | null
  rmse: number | null
  bias: number | null
}

export function useRegionalDivergence(params: { variable: string; lead_hour: number }) {
  return useQuery({
    queryKey: ['divergence-regional', params],
    queryFn: () =>
      api.get<RegionalDivergence[]>('/divergence/regional', { params }).then(r => r.data),
  })
}

export function useRunMetrics(runId: string | null) {
  return useQuery({
    queryKey: ['run-metrics', runId],
    queryFn: () => api.get<PointMetric[]>(`/runs/${runId}/metrics`).then(r => r.data),
    enabled: !!runId,
  })
}

// Alerts

export interface AlertRule {
  id: string
  variable: string
  lat: number | null
  lon: number | null
  location_label: string | null
  metric: string
  threshold: number
  comparison: string
  consecutive_hours: number
  enabled: boolean
  created_at: string
}

export interface AlertEvent {
  id: string
  rule_id: string
  triggered_at: string
  value: number
  variable: string
  lat: number
  lon: number
  location_label: string | null
  lead_hour: number
  resolved: boolean
  resolved_at: string | null
}

export function useAlertRules() {
  return useQuery({
    queryKey: ['alert-rules'],
    queryFn: () => api.get<AlertRule[]>('/alerts/rules').then(r => r.data),
  })
}

export function useActiveAlerts() {
  return useQuery({
    queryKey: ['alert-events-active'],
    queryFn: () => api.get<AlertEvent[]>('/alerts/events', { params: { active_only: true } }).then(r => r.data),
    refetchInterval: 60_000, // poll every minute
  })
}

export function useAlertEvents(limit = 50) {
  return useQuery({
    queryKey: ['alert-events', limit],
    queryFn: () => api.get<AlertEvent[]>('/alerts/events', { params: { limit } }).then(r => r.data),
  })
}

// Model point values (Forecast Outlook)

export interface ModelPointValue {
  run_id: string
  model_name: string
  variable: string
  lat: number
  lon: number
  lead_hour: number
  value: number
  init_time: string
}

export function useModelValues(params: {
  lat: number
  lon: number
  lead_hour: number
  enabled?: boolean
}) {
  const { enabled = true, ...queryParams } = params
  return useQuery({
    queryKey: ['model-values', queryParams],
    queryFn: () =>
      api
        .get<ModelPointValue[]>('/divergence/model-values', { params: queryParams })
        .then(r => r.data),
    enabled: enabled && !!queryParams.lat && !!queryParams.lon,
  })
}

// Decomposition

export interface PairMetric {
  model_a: string
  model_b: string
  rmse: number
  bias: number
}

export interface DecompositionEntry {
  lead_hour: number
  total_spread: number
  pairs: PairMetric[]
}

export function useDecomposition(params: { variable: string; lat: number; lon: number; enabled?: boolean }) {
  const { enabled = true, ...queryParams } = params
  return useQuery({
    queryKey: ['decomposition', queryParams],
    queryFn: () => api.get<DecompositionEntry[]>('/divergence/decomposition', { params: queryParams }).then(r => r.data),
    enabled: enabled && !!queryParams.lat && !!queryParams.lon,
  })
}
