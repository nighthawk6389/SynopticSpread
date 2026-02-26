# Frontend Architecture & Implementation

This document describes the technical implementation of the SynopticSpread frontend: a React single-page application that visualizes NWP model divergence data through an interactive dashboard, Leaflet-based heatmap, and Recharts time-series plots.

---

## Table of Contents

1. [Technology Stack](#1-technology-stack)
2. [Project Structure](#2-project-structure)
3. [Build & Dev Tooling](#3-build--dev-tooling)
4. [Application Entry Point & Providers](#4-application-entry-point--providers)
5. [Routing & Navigation](#5-routing--navigation)
6. [API Client Layer](#6-api-client-layer)
7. [Pages — Dashboard](#7-pages--dashboard)
8. [Pages — Map](#8-pages--map)
9. [Pages — Time Series](#9-pages--time-series)
10. [Map Components — DivergenceOverlay](#10-map-components--divergenceoverlay)
11. [Map Components — PointPopup](#11-map-components--pointpopup)
12. [Styling & Theme](#12-styling--theme)
13. [State Management Patterns](#13-state-management-patterns)
14. [Data Transformations](#14-data-transformations)
15. [Performance Optimizations](#15-performance-optimizations)
16. [End-to-End Testing](#16-end-to-end-testing)
17. [Deployment & Production Build](#17-deployment--production-build)
18. [Dependency Inventory](#18-dependency-inventory)

---

## 1. Technology Stack

| Layer | Technology | Version | Purpose |
|---|---|---|---|
| UI framework | React | 19.2 | Component-based UI with hooks |
| Build tool | Vite | 7.3+ | Fast HMR dev server + production bundler |
| Language | TypeScript | ~5.9 | Static type safety |
| Routing | React Router | 7.13+ | Client-side SPA navigation |
| Data fetching | TanStack React Query | 5.90+ | Server state caching, deduplication, retries |
| HTTP client | Axios | 1.13+ | Promise-based HTTP requests |
| Maps | Leaflet + react-leaflet | 1.9 / 5.0 | Interactive map with tile layers |
| Charts | Recharts | 3.7+ | Composable SVG line charts |
| Styling | Tailwind CSS | 4.2+ | Utility-first CSS framework (v4) |
| Linting | ESLint | 9.39+ | Code quality enforcement |
| E2E testing | Playwright | 1.56+ | Browser-based end-to-end tests |

---

## 2. Project Structure

```
frontend/
├── index.html                          # HTML entry point (mounts React)
├── package.json                        # Dependencies, scripts
├── package-lock.json                   # Lockfile
├── vite.config.ts                      # Vite + React + Tailwind plugins, proxy config
├── tsconfig.json                       # Root TS config (references app + node)
├── tsconfig.app.json                   # App source TS config (strict mode)
├── tsconfig.node.json                  # Build config TS config
├── eslint.config.js                    # ESLint flat config (TS + React hooks + React Refresh)
├── playwright.config.ts                # E2E test config
│
├── public/
│   └── vite.svg                        # Favicon
│
├── src/
│   ├── main.tsx                        # Entry: React Query + Router + StrictMode
│   ├── App.tsx                         # Root: navbar + route definitions
│   ├── index.css                       # Global: Tailwind import + Leaflet sizing
│   │
│   ├── api/
│   │   └── client.ts                   # Axios instance + 6 React Query hooks + types
│   │
│   ├── pages/
│   │   ├── DashboardPage.tsx           # Summary cards + model runs table
│   │   ├── MapPage.tsx                 # Leaflet map + controls + click handler
│   │   └── TimeSeriesPage.tsx          # Recharts line chart + location picker
│   │
│   └── components/
│       └── Map/
│           ├── DivergenceOverlay.tsx   # Leaflet rectangle grid heatmap
│           └── PointPopup.tsx          # Leaflet marker + popup for point metrics
│
└── e2e/
    ├── helpers.ts                      # Mock data + API route interceptors
    ├── dashboard.spec.ts               # Dashboard page tests (14 tests)
    ├── navigation.spec.ts              # Routing + navbar tests (11 tests)
    ├── map.spec.ts                     # Map page tests (12 tests)
    └── timeseries.spec.ts             # Time series page tests (12 tests)
```

---

## 3. Build & Dev Tooling

### 3.1 Vite Configuration

**File:** `vite.config.ts`

```typescript
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
})
```

- **Plugins:** `@vitejs/plugin-react` for JSX transform + Fast Refresh, `@tailwindcss/vite` for Tailwind v4 JIT compilation
- **Dev proxy:** All requests to `/api/*` are forwarded to the FastAPI backend at `http://localhost:8000`. This avoids CORS issues during development.
- **Output:** Production builds go to `dist/` (Vite default)

### 3.2 TypeScript Configuration

**`tsconfig.app.json`** (source files):
- Target: ES2022
- Module: ESNext with bundler resolution (Vite-optimized)
- JSX: `react-jsx` (automatic runtime — no `import React` needed)
- **Strict mode:** All strict checks enabled (`strict: true`)
- Additional checks: `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`
- Includes: `src/` only

### 3.3 ESLint Configuration

**File:** `eslint.config.js`

Flat config format (ESLint 9+) extending:
- `@eslint/js` recommended rules
- `typescript-eslint` recommended rules
- `eslint-plugin-react-hooks` — enforces Rules of Hooks
- `eslint-plugin-react-refresh` — validates Fast Refresh compatibility

Ignores `dist/` output directory. Applies to all `.ts` and `.tsx` files.

### 3.4 NPM Scripts

| Script | Command | Description |
|---|---|---|
| `dev` | `vite` | Start dev server with HMR on port 5173 |
| `build` | `tsc -b && vite build` | Type-check then bundle for production |
| `lint` | `eslint .` | Run ESLint across all source files |
| `preview` | `vite preview` | Preview production build locally |
| `test:e2e` | `playwright test` | Run E2E tests |
| `test:e2e:ui` | `playwright test --ui` | Run E2E tests in interactive UI mode |

---

## 4. Application Entry Point & Providers

**File:** `src/main.tsx`

```typescript
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,  // 1 minute
      retry: 1,           // Retry once on failure
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
```

**Provider hierarchy** (outermost → innermost):
1. **`<StrictMode>`** — React development warnings (double-renders in dev to detect side effects)
2. **`<QueryClientProvider>`** — TanStack React Query context with global defaults
3. **`<BrowserRouter>`** — React Router for client-side navigation
4. **`<App />`** — Root component

**React Query defaults:**
- `staleTime: 60_000` — Data is fresh for 1 minute after fetch; queries within this window serve cached data without refetching
- `retry: 1` — One automatic retry on network/server errors

**Global CSS:** `src/index.css` imports Tailwind and sets body/Leaflet base styles:
```css
@import "tailwindcss";
body { margin: 0; min-height: 100vh; }
.leaflet-container { height: 100%; width: 100%; }
```

---

## 5. Routing & Navigation

**File:** `src/App.tsx`

### 5.1 Route Definitions

| Path | Component | Description |
|---|---|---|
| `/` | `<DashboardPage />` | Divergence summary cards + model runs table |
| `/map` | `<MapPage />` | Interactive Leaflet map with heatmap overlay |
| `/timeseries` | `<TimeSeriesPage />` | Line chart of metrics vs. lead hour |

### 5.2 Navigation Bar

The navbar is rendered above the route outlet in every page:

```
┌───────────────────────────────────────────────────────────┐
│  SynopticSpread    Dashboard   Divergence Map   Time Series│
│  (bold, white)     (active=blue-400, inactive=gray-400)   │
└───────────────────────────────────────────────────────────┘
```

- Uses `<NavLink>` components with `end` prop on `/` to prevent prefix matching
- Active link styling: `text-blue-400 font-medium`
- Inactive link styling: `text-gray-400 hover:text-gray-200`
- Transition: `transition-colors` for smooth hover effects

### 5.3 Layout

The main content area is constrained to `max-w-7xl` (1280px) with horizontal padding (`px-4`) and vertical padding (`py-6`), centered with `mx-auto`. The entire page uses a dark background (`bg-gray-950 text-gray-100`).

---

## 6. API Client Layer

**File:** `src/api/client.ts`

### 6.1 Axios Instance

```typescript
const api = axios.create({ baseURL: '/api' })
```

All requests go to `/api/*`, which is:
- **Development:** Proxied by Vite to `http://localhost:8000/api`
- **Docker dev:** Proxied by nginx to the backend container
- **Production:** Served directly by the same container (FastAPI mounts the SPA at `/`)

### 6.2 TypeScript Interfaces

The API client defines 5 data types matching the backend Pydantic schemas:

```typescript
interface ModelRun {
  id: string
  model_name: string
  init_time: string        // ISO 8601 datetime
  forecast_hours: number[]
  status: string           // "pending" | "complete" | "error"
  created_at: string
}

interface PointMetric {
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

interface GridDivergenceData {
  variable: string
  lead_hour: number
  init_time: string
  latitudes: number[]      // 1D array of lat values
  longitudes: number[]     // 1D array of lon values
  values: number[][]       // 2D array [lat_idx][lon_idx]
  bbox: {
    min_lat: number
    max_lat: number
    min_lon: number
    max_lon: number
  }
}

interface DivergenceSummary {
  variable: string
  mean_spread: number
  max_spread: number
  num_points: number
  models_compared: string[]
  init_time: string
}

interface GridSnapshot {
  id: string
  init_time: string
  variable: string
  lead_hour: number
  bbox: Record<string, number>
  created_at: string
}
```

### 6.3 React Query Hooks

Each hook wraps an Axios GET call with `useQuery`, providing automatic caching, deduplication, and refetching.

#### `useRuns(modelName?: string)`

```
Query Key:  ['runs', modelName]
Endpoint:   GET /api/runs?model_name={modelName}
Returns:    ModelRun[]
Used by:    DashboardPage
```

#### `useVariables()`

```
Query Key:  ['variables']
Endpoint:   GET /api/variables
Returns:    Record<string, string>  (e.g., {"precip": "Total precipitation"})
Used by:    (available for future use)
```

#### `useDivergencePoint(params)`

```
Query Key:  ['divergence-point', params]
Endpoint:   GET /api/divergence/point?lat={lat}&lon={lon}&variable={variable}&lead_hour={lead_hour}
Params:     { lat: number, lon: number, variable: string, lead_hour?: number }
Enabled:    Only when lat, lon, and variable are all truthy
Returns:    PointMetric[]
Used by:    MapPage (point click), TimeSeriesPage (location metrics)
```

The `enabled` guard prevents unnecessary requests when the user hasn't selected a location yet.

#### `useDivergenceGrid(params)`

```
Query Key:  ['divergence-grid', params]
Endpoint:   GET /api/divergence/grid?variable={variable}&lead_hour={lead_hour}
Params:     { variable: string, lead_hour: number }
Returns:    GridDivergenceData
Used by:    MapPage (heatmap overlay)
```

#### `useDivergenceSummary()`

```
Query Key:  ['divergence-summary']
Endpoint:   GET /api/divergence/summary
Returns:    DivergenceSummary[]
Used by:    DashboardPage (summary cards)
```

#### `useGridSnapshots(variable?: string)`

```
Query Key:  ['grid-snapshots', variable]
Endpoint:   GET /api/divergence/grid/snapshots?variable={variable}
Returns:    GridSnapshot[]
Used by:    (available for future use)
```

---

## 7. Pages — Dashboard

**File:** `src/pages/DashboardPage.tsx`

### 7.1 Purpose

The dashboard provides an at-a-glance overview of model divergence across all tracked weather variables and recent ingestion activity.

### 7.2 Data Dependencies

| Hook | Purpose |
|---|---|
| `useDivergenceSummary()` | Fetches aggregate metrics per variable |
| `useRuns()` | Fetches the most recent model runs |

### 7.3 Layout

```
┌───────────────────────────────────────────────────┐
│  Model Divergence Dashboard                        │
│  Overview of forecast divergence across models     │
├───────────────────────────────────────────────────┤
│                                                    │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────┐│
│  │ Precip   │ │ Wind Spd │ │   MSLP   │ │H500  ││
│  │          │ │          │ │          │ │      ││
│  │ Mean: X  │ │ Mean: X  │ │ Mean: X  │ │Mean X││
│  │ Max:  X  │ │ Max:  X  │ │ Max:  X  │ │Max  X││
│  │ N points │ │ N points │ │ N points │ │N pts ││
│  └──────────┘ └──────────┘ └──────────┘ └──────┘│
│                                                    │
│  Recent Model Runs                                 │
│  ┌──────────────────────────────────────────────┐ │
│  │ Model │ Init Time  │ Status    │ Lead Hours  │ │
│  │ GFS   │ 2026-02-26 │ complete  │ 0h - 120h   │ │
│  │ NAM   │ 2026-02-26 │ pending   │ 0h - 72h    │ │
│  │ ECMWF │ 2026-02-26 │ error     │ 0h          │ │
│  └──────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────┘
```

### 7.4 Implementation Details

**Variable labels and units** are mapped via local constants:
```typescript
const VARIABLE_LABELS: Record<string, string> = {
  precip: 'Precipitation', wind_speed: 'Wind Speed',
  mslp: 'Sea-Level Pressure', hgt_500: '500mb Height',
}
const VARIABLE_UNITS: Record<string, string> = {
  precip: 'mm', wind_speed: 'm/s', mslp: 'Pa', hgt_500: 'm',
}
```

**Summary cards grid:** Responsive 4-column grid (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`). Each card shows:
- Variable name and unit
- `mean_spread` — average model spread
- `max_spread` — maximum model spread
- `num_points` — number of monitor points with data

**Loading state:** Animated pulse skeleton cards replace content while fetching.

**Empty state:** "No divergence data yet. Trigger an ingestion run to get started."

**Model runs table:**
- Columns: Model, Init Time, Status, Lead Hours
- Status badges with color coding:
  - `complete` → green (`bg-green-900 text-green-300`)
  - `error` → red (`bg-red-900 text-red-300`)
  - `pending` → yellow (`bg-yellow-900 text-yellow-300`)
- Lead hours displayed as range: `"{min}h - {max}h"` (extracted from `forecast_hours` array first and last elements)

---

## 8. Pages — Map

**File:** `src/pages/MapPage.tsx`

### 8.1 Purpose

Interactive geographic visualization of grid-level model divergence as a colored heatmap, with point-level metric inspection on click.

### 8.2 State

```typescript
const [variable, setVariable] = useState('precip')
const [leadHour, setLeadHour] = useState(0)
const [selectedPoint, setSelectedPoint] = useState<{lat: number; lon: number} | null>(null)
```

### 8.3 Data Dependencies

| Hook | Params | Purpose |
|---|---|---|
| `useDivergenceGrid({variable, lead_hour: leadHour})` | Always active | Fetches the 2D heatmap grid |
| `useDivergencePoint({lat, lon, variable, lead_hour: leadHour})` | Enabled when `selectedPoint` is set | Fetches point metrics after map click |

### 8.4 Layout

```
┌───────────────────────────────────────────────────┐
│  [Variable ▼]  Lead Hour: 0h ═══════════╸ 120h   │
│                                  Loading grid...   │
├───────────────────────────────────────────────────┤
│                                                    │
│           ┌─────────────────────────────┐         │
│           │                             │         │
│           │     Leaflet Map (600px)     │         │
│           │     CartoDB Dark Tiles      │         │
│           │     + DivergenceOverlay     │         │
│           │     + PointPopup (on click) │         │
│           │                             │         │
│           └─────────────────────────────┘         │
│                                                    │
│  Click anywhere on the map to see point-level      │
│  divergence metrics.                               │
└───────────────────────────────────────────────────┘
```

### 8.5 Implementation Details

**Variable select:** Dropdown with 4 options — `precip`, `wind_speed`, `mslp`, `hgt_500`.

**Lead hour slider:** HTML `<input type="range">` with:
- Range: 0 to 120
- Step: 6 (matching forecast hour granularity)
- Current value displayed as `"{leadHour}h"`

**Map configuration:**
- Container height: 600px (`h-[600px]`), rounded corners, gray-700 border
- Tile layer: CartoDB dark theme — `https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png`
- Default center: `[39.8, -98.5]` (geographic center of CONUS)
- Default zoom: 4
- Attribution: "OpenStreetMap contributors, CARTO"

**Map center calculation** (memoized via `useMemo`):
```typescript
const center = useMemo(() => {
  if (gridData?.bbox) {
    return [
      (gridData.bbox.min_lat + gridData.bbox.max_lat) / 2,
      (gridData.bbox.min_lon + gridData.bbox.max_lon) / 2,
    ]
  }
  return [39.8, -98.5]  // CONUS default
}, [gridData])
```

**Click handler:** `MapClickHandler` is a component that uses `react-leaflet`'s `useMapEvents` hook to capture click events:
```typescript
function MapClickHandler({ onClick }) {
  useMapEvents({
    click(e) {
      onClick({ lat: e.latlng.lat, lon: e.latlng.lng })
    },
  })
  return null
}
```

When the map is clicked, `selectedPoint` is updated, which enables the `useDivergencePoint` hook to fetch metrics for that location.

**Conditional rendering:**
- `DivergenceOverlay` is rendered only when `gridData` is available
- `PointPopup` is rendered only when both `selectedPoint` and `pointData` are available

---

## 9. Pages — Time Series

**File:** `src/pages/TimeSeriesPage.tsx`

### 9.1 Purpose

Line chart showing divergence metrics (spread, RMSE, bias) as a function of forecast lead hour at a specific geographic location.

### 9.2 State

```typescript
const [variable, setVariable] = useState('precip')
const [location, setLocation] = useState(PRESET_LOCATIONS[0])
const [customLat, setCustomLat] = useState('')
const [customLon, setCustomLon] = useState('')
```

### 9.3 Preset Locations

```typescript
const PRESET_LOCATIONS = [
  { label: 'New York',    lat: 40.7128, lon: -74.0060 },
  { label: 'Los Angeles', lat: 34.0522, lon: -118.2437 },
  { label: 'Chicago',     lat: 41.8781, lon: -87.6298 },
  { label: 'Houston',     lat: 29.7604, lon: -95.3698 },
  { label: 'Seattle',     lat: 47.6062, lon: -122.3321 },
  { label: 'Denver',      lat: 39.7392, lon: -104.9903 },
]
```

These correspond to 6 of the 8 backend monitor points (Miami and Washington DC are excluded from the frontend presets).

### 9.4 Layout

```
┌───────────────────────────────────────────────────┐
│  Divergence Time Series                            │
│  Track how model divergence evolves with forecast  │
│  lead time at a specific location.                 │
├───────────────────────────────────────────────────┤
│                                                    │
│  [Variable ▼]  [Location ▼]  Lat [    ] Lon [   ] │
│                                              [Go]  │
│                                                    │
│  Spread vs. Lead Hour — New York / Precipitation   │
│  ┌──────────────────────────────────────────────┐ │
│  │    ─── Spread (blue)                         │ │
│  │    ─── RMSE (red)                            │ │
│  │    ─── Bias (green)                          │ │
│  │                                              │ │
│  │  ↑ value                                     │ │
│  │  │                                           │ │
│  │  │     /\                                    │ │
│  │  │    /  \___/\                              │ │
│  │  │   /        \                              │ │
│  │  │──/──────────\─────────── → lead_hour      │ │
│  │  0h  24h  48h  72h  96h  120h                │ │
│  └──────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────┘
```

### 9.5 Implementation Details

**Variable select:** Same 4-option dropdown as MapPage.

**Location select:** Dropdown populated from `PRESET_LOCATIONS`. Selecting a city sets `location.lat` and `location.lon`.

**Custom coordinates:** Two text inputs (lat, lon) with a "Go" button. On click:
```typescript
const lat = parseFloat(customLat)
const lon = parseFloat(customLon)
if (!isNaN(lat) && !isNaN(lon)) {
  setLocation({ label: `${lat.toFixed(2)}, ${lon.toFixed(2)}`, lat, lon })
}
```

**Data hook:** `useDivergencePoint({ lat: location.lat, lon: location.lon, variable })` — fetches all metrics at the location without a specific lead_hour filter.

**Chart:** Recharts `<LineChart>` with responsive container:
- **X-axis:** `lead_hour` (dataKey)
- **Y-axis:** Auto-scaled to data range
- **Grid:** Dashed `<CartesianGrid>`
- **Three line series:**
  - Spread — `#60a5fa` (Tailwind blue-400)
  - RMSE — `#f87171` (Tailwind red-400)
  - Bias — `#34d399` (Tailwind emerald-400)
- **Tooltip:** Dark background styling
- **Legend:** Below the chart
- **Dot:** Disabled on lines (`dot={false}`)

**Empty state:** "No data available for this location and variable."

---

## 10. Map Components — DivergenceOverlay

**File:** `src/components/Map/DivergenceOverlay.tsx`

### 10.1 Purpose

Renders grid divergence data as colored rectangles overlaid on the Leaflet map, forming a heatmap visualization.

### 10.2 Props

```typescript
interface Props {
  data: GridDivergenceData
}
```

### 10.3 Color Mapping

The color scale maps normalized divergence values to an RGB color:

```typescript
function valueToColor(value: number, min: number, max: number): string {
  const t = max === min ? 0 : (value - min) / (max - min)
  const r = Math.round(255 * Math.min(1, t * 2))
  const g = Math.round(255 * Math.min(1, 2 - t * 2))
  const b = Math.round(255 * Math.max(0, 1 - t * 3))
  return `rgba(${r},${g},${b},0.55)`
}
```

Color progression as `t` increases from 0 to 1:
| t | R | G | B | Visual Color |
|---|---|---|---|---|
| 0.0 | 0 | 255 | 255 | Cyan (low divergence) |
| 0.17 | 85 | 255 | 128 | Green-cyan |
| 0.33 | 170 | 255 | 0 | Yellow-green |
| 0.5 | 255 | 255 | 0 | Yellow (medium) |
| 0.67 | 255 | 170 | 0 | Orange |
| 0.83 | 255 | 85 | 0 | Red-orange |
| 1.0 | 255 | 0 | 0 | Red (high divergence) |

All rectangles have 55% opacity to maintain tile layer visibility beneath the heatmap.

### 10.4 Rendering Pipeline

1. **Get map reference** via `useMap()` hook from react-leaflet
2. **Track layer reference** with `useRef<L.LayerGroup>()` for lifecycle management
3. **useEffect** runs when `data` or `map` changes:
   a. Remove previous layer (if exists) from the map
   b. Compute `min` and `max` values across the entire `data.values` 2D array
   c. Create a new `L.layerGroup()`
   d. Iterate over every grid cell `(i, j)`:
      - Calculate cell bounds from the grid spacing (assumes regular 0.25° grid):
        ```
        lat_step = (lats[1] - lats[0])   // typically 0.25
        lon_step = (lons[1] - lons[0])   // typically 0.25
        SW corner = [lats[i], lons[j]]
        NE corner = [lats[i] + lat_step, lons[j] + lon_step]
        ```
      - Create `L.rectangle(bounds, { fillColor, fillOpacity: 0.6, weight: 0 })`
      - Add to layer group
   e. Add layer group to map
4. **Cleanup:** Remove layer from map on unmount

**Returns:** `null` — this component has no DOM output; it manipulates Leaflet layers directly.

### 10.5 Performance Characteristics

For a typical CONUS grid at 0.25° resolution:
- Latitude range: ~25°N to ~50°N → ~100 cells
- Longitude range: ~125°W to ~65°W → ~240 cells
- Total rectangles: ~24,000

Each rectangle is a lightweight Leaflet SVG/Canvas element. The `L.layerGroup()` enables batch add/remove operations.

---

## 11. Map Components — PointPopup

**File:** `src/components/Map/PointPopup.tsx`

### 11.1 Purpose

Displays a map marker and information popup when the user clicks on the map.

### 11.2 Props

```typescript
interface Props {
  lat: number
  lon: number
  metrics: PointMetric[]
}
```

### 11.3 Rendering

Uses react-leaflet's `<Marker>` and `<Popup>` components:

```
┌─────────────────────────────────┐
│  📍 40.713, -74.006             │
│                                  │
│  Variable: precip                │
│  Lead Hour: 24                   │
│  Spread: 2.5000                  │
│  RMSE:   1.2000                  │
│  Bias:  -0.3000                  │
└─────────────────────────────────┘
```

- Coordinates formatted to 3 decimal places
- If `metrics` array is empty: "No divergence data at this location."
- If metrics available: displays the first (most recent) metric's fields
  - Values formatted to 4 decimal places

---

## 12. Styling & Theme

### 12.1 Tailwind CSS v4

The project uses Tailwind CSS v4 with the Vite plugin. The v4 import syntax is:
```css
@import "tailwindcss";
```

There is no `tailwind.config.js` — Tailwind v4 uses CSS-based configuration and automatic content detection.

### 12.2 Color Palette

The application uses a dark theme throughout:

| Element | Color | Tailwind Class |
|---|---|---|
| Page background | `#030712` | `bg-gray-950` |
| Navbar background | `#111827` | `bg-gray-900` |
| Card background | `#1f2937` | `bg-gray-800` |
| Card border | `#374151` | `border-gray-700` |
| Navbar border | `#1f2937` | `border-gray-800` |
| Primary text | `#f3f4f6` | `text-gray-100` |
| Secondary text | `#9ca3af` | `text-gray-400` |
| Muted text | `#6b7280` | `text-gray-500` |
| Active nav link | `#60a5fa` | `text-blue-400` |
| Complete badge | green-900/300 | `bg-green-900 text-green-300` |
| Error badge | red-900/300 | `bg-red-900 text-red-300` |
| Pending badge | yellow-900/300 | `bg-yellow-900 text-yellow-300` |

### 12.3 Map Tile Layer

The CartoDB dark basemap (`dark_all`) complements the application's dark theme:
```
https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png
```

### 12.4 Responsive Breakpoints

| Breakpoint | Usage |
|---|---|
| Default (mobile) | Single column layouts, stacked controls |
| `sm` (640px) | 2-column card grid |
| `lg` (1024px) | 4-column card grid, side-by-side controls |

### 12.5 Custom CSS

Only two custom CSS rules beyond Tailwind utilities:
```css
body { margin: 0; min-height: 100vh; }
.leaflet-container { height: 100%; width: 100%; }
```

---

## 13. State Management Patterns

### 13.1 No Global State Library

The application does not use Redux, Zustand, or React Context for state management. All state falls into two categories:

### 13.2 Server State (React Query)

All data from the backend API is managed by React Query hooks. This provides:
- **Automatic caching:** Responses are cached by query key for `staleTime` (60 seconds)
- **Deduplication:** Multiple components using the same hook with the same parameters share a single request
- **Background refetching:** Stale data is automatically refreshed when the query is re-accessed
- **Retry logic:** Failed requests are retried once

### 13.3 Local Component State (useState)

Each page manages its own UI state:

| Page | State Variables | Purpose |
|---|---|---|
| DashboardPage | (none) | All data from hooks |
| MapPage | `variable`, `leadHour`, `selectedPoint` | Filter controls + click state |
| TimeSeriesPage | `variable`, `location`, `customLat`, `customLon` | Filter controls + custom location |

State is not shared between pages. Navigating away and back resets local state to defaults but React Query serves cached data instantly.

---

## 14. Data Transformations

### 14.1 Time Series Data Grouping

**File:** `TimeSeriesPage.tsx`

The `useDivergencePoint` hook returns a flat array of `PointMetric` objects. The chart requires data grouped by lead hour. The transformation:

```typescript
const chartData = (() => {
  if (!metrics || metrics.length === 0) return []
  const byHour = new Map<number, Record<string, number>>()
  for (const m of metrics) {
    const existing = byHour.get(m.lead_hour) ?? { lead_hour: m.lead_hour }
    existing.spread = m.spread
    existing.rmse = m.rmse
    existing.bias = m.bias
    byHour.set(m.lead_hour, existing)
  }
  return Array.from(byHour.values()).sort((a, b) => a.lead_hour - b.lead_hour)
})()
```

This:
1. Groups metrics by `lead_hour` using a Map
2. Extracts `spread`, `rmse`, `bias` from each metric into a flat object
3. Sorts by lead_hour ascending (0, 6, 12, ..., 120)
4. Returns an array suitable for Recharts' `data` prop

### 14.2 Grid Divergence Color Normalization

**File:** `DivergenceOverlay.tsx`

Before coloring, the 2D values array is scanned for global min/max:
```typescript
let min = Infinity, max = -Infinity
for (const row of data.values) {
  for (const v of row) {
    if (v < min) min = v
    if (v > max) max = v
  }
}
```

Each cell value is then normalized to `[0, 1]` via `t = (value - min) / (max - min)` and mapped to a color.

### 14.3 Lead Hour Range Display

**File:** `DashboardPage.tsx`

The `forecast_hours` array (e.g., `[0, 6, 12, 24, 48, 72]`) is displayed as a range:
```typescript
`${hours[0]}h - ${hours[hours.length - 1]}h`
// → "0h - 72h"
```

### 14.4 Grid Cell Bounds Computation

**File:** `DivergenceOverlay.tsx`

Grid cell rectangle bounds are computed from the coordinate arrays:
```typescript
const lat_step = lats.length > 1 ? lats[1] - lats[0] : 0.25
const lon_step = lons.length > 1 ? lons[1] - lons[0] : 0.25
// For cell (i, j):
const bounds = [[lats[i], lons[j]], [lats[i] + lat_step, lons[j] + lon_step]]
```

---

## 15. Performance Optimizations

### 15.1 React Query Caching

- `staleTime: 60_000` prevents redundant network requests for 1 minute
- Separate query keys per parameter combination ensure fine-grained caching
- Switching between dashboard and map pages serves cached data instantly

### 15.2 Memoization

**MapPage:**
- `useMemo` for map center calculation — recomputes only when `gridData` changes (not on every render)
- `useCallback` for `handleMapClick` — stable reference prevents unnecessary child re-renders

### 15.3 Conditional Data Fetching

- `useDivergencePoint` uses `enabled: !!params.lat && !!params.lon && !!params.variable` to skip requests when no location is selected
- Custom location only triggers a fetch when valid numeric coordinates are provided

### 15.4 Leaflet Layer Lifecycle

- A single `L.layerGroup()` holds all ~24,000 grid rectangles — efficient batch add/remove
- `useRef` tracks the layer reference; cleanup runs on effect re-execution and unmount
- Previous layer is removed before creating a new one (no layer accumulation)

### 15.5 IIFE for Chart Data

The `chartData` transformation uses an immediately-invoked function expression (IIFE) to avoid creating an intermediate variable or effect. The result is a stable derived value that only recomputes when `metrics` changes.

---

## 16. End-to-End Testing

### 16.1 Playwright Configuration

**File:** `playwright.config.ts`

| Setting | Value |
|---|---|
| Test directory | `./e2e` |
| Parallel execution | Yes (local), serialized (CI) |
| Retries | 0 (local), 1 (CI) |
| Browser | Chromium only |
| Base URL | `http://localhost:5173` |
| Web server | `npm run dev` (auto-starts, 120s timeout) |
| Trace | On first retry |
| Reporter | list (+ HTML in CI) |

### 16.2 Mock API Infrastructure

**File:** `e2e/helpers.ts`

The `mockApiRoutes(page, overrides?)` function intercepts all `/api/*` requests and returns pre-defined mock data, enabling tests to run without a backend:

**Mock data constants:**
| Constant | Description |
|---|---|
| `MOCK_SUMMARIES` | 2 variables (precip, wind_speed) with spread/point data |
| `MOCK_RUNS` | 3 model runs (GFS complete, NAM pending, ECMWF error) |
| `MOCK_POINT_METRICS` | 2 metrics at New York, different lead hours |
| `MOCK_GRID` | 3x3 grid for precip at lead hour 0 |
| `MOCK_VARIABLES` | Variable name → description map |

**Route registration order:** Specific routes (e.g., `/grid/snapshots`) are registered after broader routes (e.g., `/grid`) to ensure correct LIFO matching by Playwright's `page.route()`.

**Override support:** Individual routes can be overridden per test for specific scenarios (e.g., empty responses, delayed responses).

### 16.3 Test Suites

#### Dashboard Tests (`dashboard.spec.ts`) — 14 tests

**Empty state (5 tests):**
- No summary cards displayed
- No runs in table
- Section headers still visible
- "No divergence data" message shown
- "No model runs" message shown

**Summary cards (3 tests):**
- All mock variable cards render
- Mean spread, max spread, num_points values correct
- Units displayed (mm, m/s)

**Model runs table (6 tests):**
- All 3 model names shown
- Init times formatted correctly
- Status badges have correct colors (green/yellow/red)
- Forecast hour ranges displayed
- Table headers present
- Row count matches mock data

#### Navigation Tests (`navigation.spec.ts`) — 11 tests

**Navbar (3 tests):**
- Title "SynopticSpread" visible
- All 3 navigation links present
- No extra/missing links

**Active link highlighting (3 tests):**
- Dashboard link active on `/`
- Map link active on `/map`
- Time Series link active on `/timeseries`

**Navigation via clicks (3 tests):**
- Click "Divergence Map" → URL changes to `/map`
- Click "Time Series" → URL changes to `/timeseries`
- Click "Dashboard" → URL returns to `/`

**Deep linking (2 tests):**
- Direct navigation to `/map` loads MapPage
- Direct navigation to `/timeseries` loads TimeSeriesPage

#### Map Tests (`map.spec.ts`) — 12 tests

**Page structure (3 tests):**
- Variable select dropdown present with 4 options
- Default selection is "precip"
- Select is interactive

**Lead hour slider (3 tests):**
- Slider visible on page
- Initial value is 0h
- Step size is 6

**Leaflet map (1 test):**
- `.leaflet-container` element rendered and visible

**Control interactions (3 tests):**
- Changing variable select updates selection
- Slider can be dragged
- Slider respects step=6 boundaries

**Help text (1 test):**
- "Click anywhere on the map" hint displayed

**Loading state (1 test):**
- Delayed API response shows "Loading grid..." text

#### Time Series Tests (`timeseries.spec.ts`) — 12 tests

**Page structure (2 tests):**
- Heading "Divergence Time Series" present
- Descriptive subtitle visible

**Variable select (3 tests):**
- 4 options available
- Default is "precip"
- Options include all canonical variables

**Location select (3 tests):**
- 6 preset cities listed
- Default is "New York"
- All cities present

**Chart title (3 tests):**
- Shows location + variable in title
- Updates when variable changes
- Updates when location changes

**Custom coordinates (3 tests):**
- Lat/Lon inputs and Go button visible
- Go button updates chart title to custom coordinates
- Invalid input is handled gracefully (no crash)

**Total E2E tests: 49** across 4 test suites.

---

## 17. Deployment & Production Build

### 17.1 Build Process

```bash
npm run build  →  tsc -b && vite build
```

1. **TypeScript compilation:** `tsc -b` runs the build in project-reference mode, type-checking all source files. Build errors fail the process.
2. **Vite bundling:** Produces an optimized production bundle in `dist/`:
   - JavaScript: Code-split, tree-shaken, minified
   - CSS: Tailwind utility extraction, minification
   - Assets: Hashed filenames for cache busting
   - HTML: `index.html` with injected script/link tags

### 17.2 Production Integration

In the production Docker build (root `Dockerfile`):
1. Frontend is built in a Node 22 Alpine stage → produces `dist/`
2. `dist/` is copied to `frontend_dist/` in the Python backend stage
3. FastAPI detects `frontend_dist/` at startup and mounts it with `StaticFiles(directory=..., html=True)`
4. The `html=True` flag enables SPA fallback: any unmatched route returns `index.html`, allowing React Router to handle client-side routing

### 17.3 Environment-Based API Routing

| Environment | `/api` Request Path |
|---|---|
| **Dev (Vite)** | Vite proxy → `http://localhost:8000/api` |
| **Docker dev** | nginx proxy → backend container |
| **Production** | Same container: FastAPI serves both API and SPA |

The Axios base URL is always `/api` (relative), which works in all environments without configuration.

---

## 18. Dependency Inventory

### Production Dependencies

| Package | Version | Purpose |
|---|---|---|
| `react` | ^19.2.0 | UI component framework |
| `react-dom` | ^19.2.0 | React DOM renderer |
| `react-router-dom` | ^7.13.1 | Client-side SPA routing |
| `@tanstack/react-query` | ^5.90.21 | Server state management, caching |
| `axios` | ^1.13.5 | HTTP client for API calls |
| `leaflet` | ^1.9.4 | Interactive map engine |
| `react-leaflet` | ^5.0.0 | React bindings for Leaflet |
| `@types/leaflet` | ^1.9.21 | TypeScript types for Leaflet |
| `recharts` | ^3.7.0 | SVG charting library |
| `tailwindcss` | ^4.2.1 | Utility-first CSS framework |
| `@tailwindcss/vite` | ^4.2.1 | Tailwind CSS Vite plugin |

### Development Dependencies

| Package | Version | Purpose |
|---|---|---|
| `vite` | ^7.3.1 | Build tool + dev server |
| `@vitejs/plugin-react` | ^4.x | JSX transform + Fast Refresh |
| `typescript` | ~5.9.3 | Static type checking |
| `eslint` | ^9.39.1 | Code linting |
| `@eslint/js` | ^9.x | ESLint core rules |
| `typescript-eslint` | ^8.x | TS-specific ESLint rules |
| `eslint-plugin-react-hooks` | ^5.x | Rules of Hooks enforcement |
| `eslint-plugin-react-refresh` | ^0.4.x | Fast Refresh compatibility checks |
| `@playwright/test` | ^1.56.1 | End-to-end browser testing |
| `@types/react` | ^19.x | React TypeScript types |
| `@types/react-dom` | ^19.x | ReactDOM TypeScript types |
| `globals` | ^16.x | ESLint global variable definitions |
