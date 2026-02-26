import uuid
from datetime import datetime

from pydantic import BaseModel


class AlertRuleCreate(BaseModel):
    variable: str
    lat: float | None = None
    lon: float | None = None
    location_label: str | None = None
    metric: str = "spread"  # "spread", "rmse", "bias"
    threshold: float = 5.0
    comparison: str = "gt"  # "gt" or "lt"
    consecutive_hours: int = 1
    enabled: bool = True


class AlertRuleUpdate(BaseModel):
    variable: str | None = None
    lat: float | None = None
    lon: float | None = None
    location_label: str | None = None
    metric: str | None = None
    threshold: float | None = None
    comparison: str | None = None
    consecutive_hours: int | None = None
    enabled: bool | None = None


class AlertRuleOut(BaseModel):
    id: uuid.UUID
    variable: str
    lat: float | None
    lon: float | None
    location_label: str | None
    metric: str
    threshold: float
    comparison: str
    consecutive_hours: int
    enabled: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class AlertEventOut(BaseModel):
    id: uuid.UUID
    rule_id: uuid.UUID
    triggered_at: datetime
    value: float
    variable: str
    lat: float
    lon: float
    location_label: str | None
    lead_hour: int
    resolved: bool
    resolved_at: datetime | None

    model_config = {"from_attributes": True}
