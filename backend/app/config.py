from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://jellyroll:jellyroll@localhost:5432/jellyroll"
    cors_origins: list[str] = [
        "http://localhost:8000",
        "http://localhost:3000",
        "https://meiruep.github.io",
    ]
    api_key: str = "dev-key-change-me"

    model_config = SettingsConfigDict(env_file=".env", env_prefix="JR_")


@lru_cache
def get_settings() -> Settings:
    return Settings()
