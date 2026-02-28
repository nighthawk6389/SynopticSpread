import uuid
from datetime import datetime

from pydantic import BaseModel


class PointMetricOut(BaseModel):
    id: uuid.UUID
    run_a_id: uuid.UUID
    run_b_id: uuid.UUID
    variable: str
    lat: float
    lon: float
    lead_hour: int
    rmse: float
    bias: float
    spread: float
    created_at: datetime

    model_config = {"from_attributes": True}


class GridSnapshotOut(BaseModel):
    id: uuid.UUID
    init_time: datetime
    variable: str
    lead_hour: int
    bbox: dict
    created_at: datetime

    model_config = {"from_attributes": True}


class GridDivergenceData(BaseModel):
    """Flattened grid divergence for JSON transport."""

    variable: str
    lead_hour: int
    init_time: str
    latitudes: list[float]
    longitudes: list[float]
    values: list[list[float]]  # 2D array [lat][lon]
    bbox: dict


class DivergenceSummary(BaseModel):
    """Quick summary stats for the dashboard."""

    variable: str
    mean_spread: float
    median_spread: float
    max_spread: float
    min_spread: float
    num_points: int
    models_compared: list[str]
    init_time: str


class SpreadHistoryPoint(BaseModel):
    timestamp: str
    mean_spread: float


class SpreadHistoryOut(BaseModel):
    variable: str
    points: list[SpreadHistoryPoint]


class ModelPointValueOut(BaseModel):
    """Raw predicted value from a single model at a single monitor point."""

    run_id: uuid.UUID
    model_name: str
    variable: str
    lat: float
    lon: float
    lead_hour: int
    value: float
    init_time: datetime

    model_config = {"from_attributes": True}
