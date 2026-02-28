import { useState } from 'react'
import { NavLink, Route, Routes } from 'react-router-dom'
import AlertsPage from './pages/AlertsPage'
import DashboardPage from './pages/DashboardPage'
import MapPage from './pages/MapPage'
import OutlookPage from './pages/OutlookPage'
import TimeSeriesPage from './pages/TimeSeriesPage'

const navLinks = [
  { to: '/', label: 'Dashboard', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1' },
  { to: '/outlook', label: 'Outlook', icon: 'M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z' },
  { to: '/map', label: 'Map', icon: 'M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7' },
  { to: '/timeseries', label: 'Time Series', icon: 'M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z' },
  { to: '/alerts', label: 'Alerts', icon: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9' },
]

export default function App() {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div className="min-h-screen" style={{ fontFamily: "var(--font-body)" }}>
      {/* Navigation */}
      <nav className="glass-panel sticky top-0 z-50" style={{ borderTop: 'none', borderLeft: 'none', borderRight: 'none' }}>
        <div className="mx-auto flex max-w-[1400px] items-center justify-between px-6 py-3">
          {/* Logo */}
          <NavLink to="/" className="flex items-center gap-3 group">
            <div className="relative w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, var(--accent-dim), var(--accent))' }}>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                className="w-4.5 h-4.5" style={{ color: '#FFFFFF' }} strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <span className="text-base font-semibold tracking-tight group-hover:opacity-80 transition-opacity"
              style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
              SynopticSpread
            </span>
          </NavLink>

          {/* Desktop nav links */}
          <div className="hidden md:flex items-center gap-1">
            {navLinks.map(link => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.to === '/'}
                className={({ isActive }) =>
                  `flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                    isActive
                      ? ''
                      : ''
                  }`
                }
                style={({ isActive }) => ({
                  color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
                  background: isActive ? 'var(--accent-glow)' : undefined,
                })}
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                  strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d={link.icon} />
                </svg>
                {link.label}
              </NavLink>
            ))}
          </div>

          {/* Mobile hamburger */}
          <button
            className="md:hidden flex flex-col gap-1.5 p-2"
            onClick={() => setMobileOpen(o => !o)}
            aria-label="Toggle navigation"
          >
            <span className="block w-5 h-0.5 rounded-full transition-all duration-300"
              style={{
                background: 'var(--text-secondary)',
                transform: mobileOpen ? 'rotate(45deg) translateY(4px)' : 'none',
              }} />
            <span className="block w-5 h-0.5 rounded-full transition-all duration-300"
              style={{
                background: 'var(--text-secondary)',
                opacity: mobileOpen ? 0 : 1,
              }} />
            <span className="block w-5 h-0.5 rounded-full transition-all duration-300"
              style={{
                background: 'var(--text-secondary)',
                transform: mobileOpen ? 'rotate(-45deg) translateY(-4px)' : 'none',
              }} />
          </button>
        </div>

        {/* Accent line under nav */}
        <div className="glow-line" />
      </nav>

      {/* Mobile nav overlay */}
      <div className={`nav-links ${mobileOpen ? 'open' : ''} md:hidden`}>
        <button
          className="absolute top-5 right-6 p-2"
          style={{ color: 'var(--text-secondary)' }}
          onClick={() => setMobileOpen(false)}
          aria-label="Close navigation"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
            strokeWidth={2} stroke="currentColor" className="w-6 h-6">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        {navLinks.map(link => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.to === '/'}
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-3 text-lg font-medium transition-colors ${
                isActive ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`
            }
            style={{ fontFamily: 'var(--font-display)' }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
              strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d={link.icon} />
            </svg>
            {link.label}
          </NavLink>
        ))}
      </div>

      <main className="mx-auto max-w-[1400px] px-6 py-8">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/map" element={<MapPage />} />
          <Route path="/timeseries" element={<TimeSeriesPage />} />
          <Route path="/outlook" element={<OutlookPage />} />
          <Route path="/alerts" element={<AlertsPage />} />
        </Routes>
      </main>
    </div>
  )
}
