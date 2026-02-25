import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, String
from sqlalchemy.dialects.postgresql import ARRAY, INTEGER, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.database import Base


class RunStatus(str, enum.Enum):
    pending = "pending"
    complete = "complete"
    error = "error"


class ModelRun(Base):
    __tablename__ = "model_runs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    model_name: Mapped[str] = mapped_column(String(16), index=True)
    init_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    forecast_hours: Mapped[list[int]] = mapped_column(ARRAY(INTEGER))
    status: Mapped[RunStatus] = mapped_column(
        Enum(RunStatus), default=RunStatus.pending
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
