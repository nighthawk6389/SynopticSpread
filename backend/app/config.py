import logging
import re
from pathlib import Path

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)


def _redact_url(url: str) -> str:
    """Replace the password in a database URL with '***'."""
    return re.sub(r"://([^:]+):([^@]+)@", r"://\1:***@", url)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
    )

    database_url: str = (
        "postgresql+asyncpg://synoptic:synoptic@localhost:5432/synopticspread"
    )

    @model_validator(mode="after")
    def _normalize_database_url(self) -> "Settings":
        """Ensure the database URL uses the asyncpg driver.

        Render (and other providers) supply ``postgres://`` or
        ``postgresql://`` connection strings.  SQLAlchemy's async engine
        requires the ``postgresql+asyncpg://`` scheme.
        """
        url = self.database_url
        logger.info("DATABASE_URL raw value: %s", _redact_url(url))
        if url.startswith("postgres://"):
            url = url.replace("postgres://", "postgresql+asyncpg://", 1)
        elif url.startswith("postgresql://"):
            url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
        self.database_url = url
        logger.info("DATABASE_URL after normalization: %s", _redact_url(url))
        return self
    ecmwf_api_key: str = ""
    ecmwf_api_url: str = "https://cds.climate.copernicus.eu/api"
    data_store_path: Path = Path("./data")
    scheduler_enabled: bool = True
    # Create ORM tables automatically on startup (set to true in production).
    database_auto_create: bool = False
    # Origins allowed by the CORS middleware (comma-separated list or JSON array).
    allowed_origins: list[str] = ["http://localhost:5173"]
    # Trigger ingestion for all models on startup when no data exists yet.
    seed_data_on_startup: bool = False
    # Alerting
    alert_webhook_url: str = ""
    alert_check_enabled: bool = True

    # Predefined monitoring points (lat, lon, label)
    monitor_points: list[tuple[float, float, str]] = [
        (40.7128, -74.0060, "New York"),
        (34.0522, -118.2437, "Los Angeles"),
        (41.8781, -87.6298, "Chicago"),
        (29.7604, -95.3698, "Houston"),
        (47.6062, -122.3321, "Seattle"),
        (39.7392, -104.9903, "Denver"),
        (25.7617, -80.1918, "Miami"),
        (38.9072, -77.0369, "Washington DC"),
        (33.7490, -84.3880, "Atlanta"),
        (42.3601, -71.0589, "Boston"),
        (44.9778, -93.2650, "Minneapolis"),
        (33.4484, -112.0740, "Phoenix"),
        (37.7749, -122.4194, "San Francisco"),
        (32.7767, -96.7970, "Dallas"),
        (45.5155, -122.6789, "Portland"),
        (42.3314, -83.0458, "Detroit"),
        (36.1627, -86.7816, "Nashville"),
        (39.9612, -82.9988, "Columbus"),
        (35.2271, -80.8431, "Charlotte"),
        (32.7157, -117.1611, "San Diego"),
    ]


settings = Settings()
