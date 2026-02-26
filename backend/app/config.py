from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
    )

    database_url: str = "postgresql+asyncpg://synoptic:synoptic@localhost:5432/synopticspread"
    ecmwf_api_key: str = ""
    ecmwf_api_url: str = "https://cds.climate.copernicus.eu/api"
    data_store_path: Path = Path("./data")
    scheduler_enabled: bool = True
    # Create ORM tables automatically on startup (set to true in production).
    database_auto_create: bool = False
    # Origins allowed by the CORS middleware (comma-separated list or JSON array).
    allowed_origins: list[str] = ["http://localhost:5173"]
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
