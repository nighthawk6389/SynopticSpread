import { useState } from 'react'
import type { AlertEvent, AlertRule } from '../api/client'
import { useAlertEvents, useAlertRules, useMonitorPoints } from '../api/client'
import axios from 'axios'
import { useQueryClient } from '@tanstack/react-query'
import ResponsiveTable from '../components/ResponsiveTable'
import type { Column } from '../components/ResponsiveTable'

const api = axios.create({ baseURL: '/api' })

const VARIABLES = [
  { value: 'precip', label: 'Precipitation' },
  { value: 'wind_speed', label: 'Wind Speed' },
  { value: 'mslp', label: 'Sea-Level Pressure' },
  { value: 'hgt_500', label: '500mb Heights' },
]

const METRICS = ['spread', 'rmse', 'bias']

export default function AlertsPage() {
  const queryClient = useQueryClient()
  const { data: rules, isLoading: rulesLoading } = useAlertRules()
  const { data: events, isLoading: eventsLoading } = useAlertEvents()
  const { data: monitorPoints } = useMonitorPoints()

  const [showForm, setShowForm] = useState(false)
  const [formVariable, setFormVariable] = useState('precip')
  const [formMetric, setFormMetric] = useState('spread')
  const [formThreshold, setFormThreshold] = useState('5')
  const [formComparison, setFormComparison] = useState('gt')
  const [formLocation, setFormLocation] = useState('any')
  const [formConsecutive] = useState('1')

  const handleCreateRule = async () => {
    const body: Record<string, unknown> = {
      variable: formVariable,
      metric: formMetric,
      threshold: parseFloat(formThreshold),
      comparison: formComparison,
      consecutive_hours: parseInt(formConsecutive) || 1,
    }
    if (formLocation !== 'any') {
      const pt = monitorPoints?.find(p => `${p.lat},${p.lon}` === formLocation)
      if (pt) {
        body.lat = pt.lat
        body.lon = pt.lon
        body.location_label = pt.label
      }
    }
    await api.post('/alerts/rules', body)
    queryClient.invalidateQueries({ queryKey: ['alert-rules'] })
    setShowForm(false)
  }

  const handleDeleteRule = async (id: string) => {
    await api.delete(`/alerts/rules/${id}`)
    queryClient.invalidateQueries({ queryKey: ['alert-rules'] })
  }

  const handleToggleRule = async (rule: AlertRule) => {
    await api.put(`/alerts/rules/${rule.id}`, { enabled: !rule.enabled })
    queryClient.invalidateQueries({ queryKey: ['alert-rules'] })
  }

  const handleResolve = async (id: string) => {
    await api.post(`/alerts/events/${id}/resolve`)
    queryClient.invalidateQueries({ queryKey: ['alert-events'] })
    queryClient.invalidateQueries({ queryKey: ['alert-events-active'] })
  }

  const ruleColumns: Column<AlertRule>[] = [
    {
      key: 'variable',
      header: 'Variable',
      render: (rule) => (
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 500 }}>{rule.variable}</span>
      ),
    },
    {
      key: 'metric',
      header: 'Metric',
      render: (rule) => <span style={{ color: 'var(--text-secondary)' }}>{rule.metric}</span>,
    },
    {
      key: 'condition',
      header: 'Condition',
      render: (rule) => (
        <span style={{ color: 'var(--text-tertiary)' }}>
          {rule.comparison === 'gt' ? '>' : '<'} {rule.threshold}
          {rule.consecutive_hours > 1 && ` (${rule.consecutive_hours}h consecutive)`}
        </span>
      ),
    },
    {
      key: 'location',
      header: 'Location',
      render: (rule) => <span style={{ color: 'var(--text-tertiary)' }}>{rule.location_label ?? 'Any'}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (rule) => (
        <span className={`badge ${rule.enabled ? 'badge-green' : 'badge-neutral'}`}>
          {rule.enabled ? 'Enabled' : 'Disabled'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (rule) => (
        <div className="flex gap-3">
          <button onClick={(e) => { e.stopPropagation(); handleToggleRule(rule) }}
            className="text-xs font-medium transition-colors"
            style={{ color: 'var(--accent)' }}>
            {rule.enabled ? 'Disable' : 'Enable'}
          </button>
          <button onClick={(e) => { e.stopPropagation(); handleDeleteRule(rule.id) }}
            className="text-xs font-medium transition-colors"
            style={{ color: 'var(--red)' }}>
            Delete
          </button>
        </div>
      ),
    },
  ]

  const eventColumns: Column<AlertEvent>[] = [
    {
      key: 'time',
      header: 'Time',
      render: (event) => (
        <span style={{ color: 'var(--text-tertiary)' }}>{new Date(event.triggered_at).toLocaleString()}</span>
      ),
    },
    {
      key: 'variable',
      header: 'Variable',
      render: (event) => (
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 500 }}>{event.variable}</span>
      ),
    },
    {
      key: 'location',
      header: 'Location',
      render: (event) => (
        <span style={{ color: 'var(--text-tertiary)' }}>
          {event.location_label ?? `${event.lat.toFixed(2)}, ${event.lon.toFixed(2)}`}
        </span>
      ),
    },
    {
      key: 'lead_hour',
      header: 'Lead Hour',
      render: (event) => <span>{event.lead_hour}h</span>,
    },
    {
      key: 'value',
      header: 'Value',
      render: (event) => (
        <span className="font-mono" style={{ fontWeight: 600 }}>{event.value.toFixed(3)}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (event) => (
        <span className={`badge ${event.resolved ? 'badge-neutral' : 'badge-red'}`}>
          {event.resolved ? 'Resolved' : 'Active'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (event) => (
        <>
          {!event.resolved && (
            <button onClick={(e) => { e.stopPropagation(); handleResolve(event.id) }}
              className="text-xs font-medium transition-colors"
              style={{ color: 'var(--green)' }}>
              Resolve
            </button>
          )}
        </>
      ),
    },
  ]

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="animate-slide-up">
        <h2 className="section-title text-2xl" style={{ fontFamily: 'var(--font-display)' }}>Alerts</h2>
        <p className="section-subtitle mt-2">
          Configure alert rules and view triggered events.
        </p>
      </div>

      {/* Alert Rules */}
      <div className="animate-slide-up delay-1">
        <div className="flex items-center justify-between mb-4">
          <h3 className="section-title text-lg" style={{ fontFamily: 'var(--font-display)' }}>Alert Rules</h3>
          <button
            onClick={() => setShowForm(f => !f)}
            className={showForm ? 'btn-ghost' : 'btn-primary'}
          >
            {showForm ? 'Cancel' : 'Add Rule'}
          </button>
        </div>

        {showForm && (
          <div className="glass-card p-5 mb-5 animate-scale-in">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              <div>
                <label className="block text-xs font-medium mb-1.5"
                  style={{ color: 'var(--text-tertiary)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                  Variable
                </label>
                <select value={formVariable} onChange={e => setFormVariable(e.target.value)}
                  className="control-select w-full">
                  {VARIABLES.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5"
                  style={{ color: 'var(--text-tertiary)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                  Metric
                </label>
                <select value={formMetric} onChange={e => setFormMetric(e.target.value)}
                  className="control-select w-full">
                  {METRICS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5"
                  style={{ color: 'var(--text-tertiary)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                  Comparison
                </label>
                <select value={formComparison} onChange={e => setFormComparison(e.target.value)}
                  className="control-select w-full">
                  <option value="gt">Greater than</option>
                  <option value="lt">Less than</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5"
                  style={{ color: 'var(--text-tertiary)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                  Threshold
                </label>
                <input type="number" value={formThreshold} onChange={e => setFormThreshold(e.target.value)}
                  className="control-input w-full" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5"
                  style={{ color: 'var(--text-tertiary)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                  Location
                </label>
                <select value={formLocation} onChange={e => setFormLocation(e.target.value)}
                  className="control-select w-full">
                  <option value="any">Any Location</option>
                  {monitorPoints?.map(pt => (
                    <option key={pt.label} value={`${pt.lat},${pt.lon}`}>{pt.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-end">
                <button onClick={handleCreateRule} className="btn-primary w-full">
                  Create
                </button>
              </div>
            </div>
          </div>
        )}

        {rulesLoading ? (
          <div className="glass-card p-10 text-center" style={{ color: 'var(--text-tertiary)' }}>Loading...</div>
        ) : (
          <ResponsiveTable
            columns={ruleColumns}
            data={rules ?? []}
            keyFn={rule => rule.id}
            emptyMessage="No alert rules configured."
          />
        )}
      </div>

      {/* Alert Events */}
      <div className="animate-slide-up delay-2">
        <h3 className="section-title text-lg mb-4" style={{ fontFamily: 'var(--font-display)' }}>Recent Events</h3>
        {eventsLoading ? (
          <div className="glass-card p-10 text-center" style={{ color: 'var(--text-tertiary)' }}>Loading...</div>
        ) : (
          <ResponsiveTable
            columns={eventColumns}
            data={events ?? []}
            keyFn={event => event.id}
            emptyMessage="No alert events."
          />
        )}
      </div>
    </div>
  )
}
