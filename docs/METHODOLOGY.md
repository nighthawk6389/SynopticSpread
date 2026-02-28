# Divergence Methodology

How SynopticSpread measures forecast disagreement between numerical weather prediction (NWP) models.

## What is being compared?

SynopticSpread tracks **six NWP models** and computes pairwise divergence between every combination:

| Model | Resolution | Cycles | Source |
|-------|-----------|--------|--------|
| GFS | 0.25° global | 00/06/12/18Z | NOAA NOMADS |
| NAM | 3 km CONUS (Lambert Conformal) | 00/06/12/18Z | NOAA NOMADS |
| HRRR | 3 km CONUS (Lambert Conformal) | 00/06/12/18Z | NOAA NOMADS |
| ECMWF IFS | 0.25° global | 00/06/12/18Z | ECMWF Open Data |
| AIGFS | 0.25° global (AI/GraphCast) | 00/12Z | NOAA NOMADS |
| RRFS | 3 km CONUS (Lambert Conformal) | 00/06/12/18Z | NOAA NOMADS |

With 6 models this produces **15 unique pairwise comparisons** (C(6,2) = 15). Each pair is compared independently at every monitored location, for every forecast lead hour, and for every tracked variable.

## Tracked variables

| Variable | Description | Raw units | Typical spread thresholds |
|----------|-------------|-----------|--------------------------|
| `precip` | Total accumulated precipitation | mm | Low < 3, Elevated 3-8, High > 8 |
| `wind_speed` | 10-metre wind speed (from U/V components) | m/s | Low < 2, Elevated 2-5, High > 5 |
| `mslp` | Mean sea-level pressure | Pa | Low < 100, Elevated 100-300, High > 300 |
| `hgt_500` | 500 hPa geopotential height | m | Low < 20, Elevated 20-60, High > 60 |

## Metrics

### RMSE (pairwise)

For a single point and a single lead hour, the RMSE between two models is the absolute difference of their predicted values:

```
RMSE(A, B) = |value_A - value_B|
```

This is the point-level RMSE; since there is one observation per model at a point, it reduces to the absolute difference. The dashboard aggregates these across lead hours and monitor points.

### Bias (pairwise)

The signed difference between two models:

```
Bias(A, B) = value_A - value_B
```

A positive bias means model A predicts a higher value than model B. Bias reveals directional disagreement (e.g., one model consistently forecasts more rain than another).

### Ensemble spread

The standard deviation across **all available models** at a single point, using Bessel's correction:

```
Spread = std(value_GFS, value_NAM, value_ECMWF, ..., ddof=1)
```

This is the headline metric shown on the dashboard. A spread of 0 means perfect model agreement; higher values indicate greater forecast uncertainty.

### Grid divergence

The same standard-deviation calculation applied per grid cell across a common 0.25° lat/lon grid. All models are first regridded to this common resolution via nearest-neighbour interpolation. The result is a spatial map of model disagreement stored as Zarr files.

## Dashboard summary

The dashboard summary cards show the **average ensemble spread** within a 0-48 hour forecast window. The statistics shown are:

- **Avg** - Mean of the spread values across all monitor points and lead hours in the window.
- **Median** - Median spread, less sensitive to outliers than the mean.
- **Min / Max** - The extremes of the spread distribution in the window.

The agreement level badge (Normal / Elevated / High) is determined by comparing the mean spread against the thresholds listed in the variables table above.

## Pair contributions

The pair contributions section shows which model pair disagrees most. For each pair, the average RMSE is computed across all lead hours at the selected location:

```
avgRmse(A-B) = mean(RMSE(A, B) at each lead hour)
```

Pairs are sorted from most divergent to least. The bar colour indicates relative magnitude: red (top third), yellow (middle third), green (bottom third).

## Data flow

1. **Phase 1 - Ingestion**: Each model is fetched independently via its `ModelFetcher`. Raw per-model values are stored as `ModelPointValue` rows at each of the 20 monitored US cities.

2. **Phase 2 - Divergence**: After all models for a cycle are ingested, `recompute_cycle_divergence` processes one lead hour at a time (to limit peak memory to ~100 MB). It computes pairwise RMSE/bias and ensemble spread at every monitor point, and grid-level standard deviation saved as Zarr.

## Monitor points

20 US cities are tracked: New York, Los Angeles, Chicago, Houston, Seattle, Denver, Miami, Washington DC, Atlanta, Boston, Minneapolis, Phoenix, San Francisco, Dallas, Portland, Detroit, Nashville, Columbus, Charlotte, and San Diego.
