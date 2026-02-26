import { useState } from 'react'
import type { AlertRule } from '../api/client'
import { useAlertEvents, useAlertRules, useMonitorPoints } from '../api/client'
import axios from 'axios'
import { useQueryClient } from '@tanstack/react-query'

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

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold">Alerts</h2>
        <p className="mt-1 text-sm text-gray-400">
          Configure alert rules and view triggered events.
        </p>
      </div>

      {/* Alert Rules */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold">Alert Rules</h3>
          <button
            onClick={() => setShowForm(f => !f)}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium hover:bg-blue-500"
          >
            {showForm ? 'Cancel' : 'Add Rule'}
          </button>
        </div>

        {showForm && (
          <div className="rounded-lg border border-gray-700 bg-gray-800 p-4 mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Variable</label>
              <select value={formVariable} onChange={e => setFormVariable(e.target.value)}
                className="w-full rounded bg-gray-700 border border-gray-600 px-2 py-1.5 text-sm">
                {VARIABLES.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Metric</label>
              <select value={formMetric} onChange={e => setFormMetric(e.target.value)}
                className="w-full rounded bg-gray-700 border border-gray-600 px-2 py-1.5 text-sm">
                {METRICS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Comparison</label>
              <select value={formComparison} onChange={e => setFormComparison(e.target.value)}
                className="w-full rounded bg-gray-700 border border-gray-600 px-2 py-1.5 text-sm">
                <option value="gt">Greater than</option>
                <option value="lt">Less than</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Threshold</label>
              <input type="number" value={formThreshold} onChange={e => setFormThreshold(e.target.value)}
                className="w-full rounded bg-gray-700 border border-gray-600 px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Location</label>
              <select value={formLocation} onChange={e => setFormLocation(e.target.value)}
                className="w-full rounded bg-gray-700 border border-gray-600 px-2 py-1.5 text-sm">
                <option value="any">Any Location</option>
                {monitorPoints?.map(pt => (
                  <option key={pt.label} value={`${pt.lat},${pt.lon}`}>{pt.label}</option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <button onClick={handleCreateRule}
                className="w-full rounded bg-green-600 px-3 py-1.5 text-sm font-medium hover:bg-green-500">
                Create
              </button>
            </div>
          </div>
        )}

        <div className="overflow-hidden rounded-lg border border-gray-700">
          <table className="w-full text-sm">
            <thead className="bg-gray-800">
              <tr>
                <th className="px-4 py-2 text-left text-gray-400">Variable</th>
                <th className="px-4 py-2 text-left text-gray-400">Metric</th>
                <th className="px-4 py-2 text-left text-gray-400">Condition</th>
                <th className="px-4 py-2 text-left text-gray-400">Location</th>
                <th className="px-4 py-2 text-left text-gray-400">Status</th>
                <th className="px-4 py-2 text-left text-gray-400">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {rulesLoading ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">Loading...</td></tr>
              ) : rules && rules.length > 0 ? (
                rules.map(rule => (
                  <tr key={rule.id}>
                    <td className="px-4 py-2">{rule.variable}</td>
                    <td className="px-4 py-2">{rule.metric}</td>
                    <td className="px-4 py-2 text-gray-400">
                      {rule.comparison === 'gt' ? '>' : '<'} {rule.threshold}
                      {rule.consecutive_hours > 1 && ` (${rule.consecutive_hours}h consecutive)`}
                    </td>
                    <td className="px-4 py-2 text-gray-400">{rule.location_label ?? 'Any'}</td>
                    <td className="px-4 py-2">
                      <span className={`text-xs rounded-full px-2 py-0.5 font-medium ${
                        rule.enabled ? 'bg-green-900 text-green-300' : 'bg-gray-700 text-gray-400'
                      }`}>
                        {rule.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </td>
                    <td className="px-4 py-2 flex gap-2">
                      <button onClick={() => handleToggleRule(rule)}
                        className="text-xs text-blue-400 hover:text-blue-300">
                        {rule.enabled ? 'Disable' : 'Enable'}
                      </button>
                      <button onClick={() => handleDeleteRule(rule.id)}
                        className="text-xs text-red-400 hover:text-red-300">
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">No alert rules configured.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Alert Events */}
      <div>
        <h3 className="text-lg font-semibold mb-3">Recent Events</h3>
        <div className="overflow-hidden rounded-lg border border-gray-700">
          <table className="w-full text-sm">
            <thead className="bg-gray-800">
              <tr>
                <th className="px-4 py-2 text-left text-gray-400">Time</th>
                <th className="px-4 py-2 text-left text-gray-400">Variable</th>
                <th className="px-4 py-2 text-left text-gray-400">Location</th>
                <th className="px-4 py-2 text-left text-gray-400">Lead Hour</th>
                <th className="px-4 py-2 text-left text-gray-400">Value</th>
                <th className="px-4 py-2 text-left text-gray-400">Status</th>
                <th className="px-4 py-2 text-left text-gray-400">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {eventsLoading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">Loading...</td></tr>
              ) : events && events.length > 0 ? (
                events.map(event => (
                  <tr key={event.id}>
                    <td className="px-4 py-2 text-gray-400">{new Date(event.triggered_at).toLocaleString()}</td>
                    <td className="px-4 py-2">{event.variable}</td>
                    <td className="px-4 py-2 text-gray-400">{event.location_label ?? `${event.lat.toFixed(2)}, ${event.lon.toFixed(2)}`}</td>
                    <td className="px-4 py-2">{event.lead_hour}h</td>
                    <td className="px-4 py-2 font-medium">{event.value.toFixed(3)}</td>
                    <td className="px-4 py-2">
                      <span className={`text-xs rounded-full px-2 py-0.5 font-medium ${
                        event.resolved ? 'bg-gray-700 text-gray-400' : 'bg-red-900 text-red-300'
                      }`}>
                        {event.resolved ? 'Resolved' : 'Active'}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      {!event.resolved && (
                        <button onClick={() => handleResolve(event.id)}
                          className="text-xs text-green-400 hover:text-green-300">
                          Resolve
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">No alert events.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
