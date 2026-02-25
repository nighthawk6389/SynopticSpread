import { NavLink, Route, Routes } from 'react-router-dom'
import DashboardPage from './pages/DashboardPage'
import MapPage from './pages/MapPage'
import TimeSeriesPage from './pages/TimeSeriesPage'

const navLinks = [
  { to: '/', label: 'Dashboard' },
  { to: '/map', label: 'Divergence Map' },
  { to: '/timeseries', label: 'Time Series' },
]

export default function App() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <nav className="border-b border-gray-800 bg-gray-900">
        <div className="mx-auto flex max-w-7xl items-center gap-8 px-4 py-3">
          <h1 className="text-lg font-bold tracking-tight text-white">
            SynopticSpread
          </h1>
          <div className="flex gap-4">
            {navLinks.map(link => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.to === '/'}
                className={({ isActive }) =>
                  `text-sm transition-colors ${isActive ? 'text-blue-400 font-medium' : 'text-gray-400 hover:text-gray-200'}`
                }
              >
                {link.label}
              </NavLink>
            ))}
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-7xl px-4 py-6">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/map" element={<MapPage />} />
          <Route path="/timeseries" element={<TimeSeriesPage />} />
        </Routes>
      </main>
    </div>
  )
}
