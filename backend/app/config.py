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
    ]


settings = Settings()
