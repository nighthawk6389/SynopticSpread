import uuid
from datetime import datetime

from pydantic import BaseModel


class ModelRunOut(BaseModel):
    id: uuid.UUID
    model_name: str
    init_time: datetime
    forecast_hours: list[int]
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


class ForecastPointRequest(BaseModel):
    lat: float
    lon: float
    variable: str
    model_name: str | None = None
    init_time: datetime | None = None
