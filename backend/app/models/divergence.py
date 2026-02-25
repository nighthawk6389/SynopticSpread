import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSON, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.database import Base


class PointMetric(Base):
    __tablename__ = "point_metrics"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    run_a_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("model_runs.id"), index=True
    )
    run_b_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("model_runs.id"), index=True
    )
    variable: Mapped[str] = mapped_column(String(32), index=True)
    lat: Mapped[float] = mapped_column(Float)
    lon: Mapped[float] = mapped_column(Float)
    lead_hour: Mapped[int] = mapped_column(Integer, index=True)
    rmse: Mapped[float] = mapped_column(Float)
    bias: Mapped[float] = mapped_column(Float)
    spread: Mapped[float] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class GridSnapshot(Base):
    __tablename__ = "grid_snapshots"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    init_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    variable: Mapped[str] = mapped_column(String(32), index=True)
    lead_hour: Mapped[int] = mapped_column(Integer)
    zarr_path: Mapped[str] = mapped_column(String(512))
    bbox: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
