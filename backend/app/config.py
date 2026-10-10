from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parents[1] / ".env",
        env_file_encoding="utf-8-sig",
        env_prefix="UMS_",
        extra="forbid",
    )

    app_name: str = "Utility Management API"
    docs_enabled: bool = True
    database_url: str | None = None
    jwt_secret: str | None = None
