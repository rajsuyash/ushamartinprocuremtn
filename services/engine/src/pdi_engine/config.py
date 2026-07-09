"""Configuration for PDI engine."""
import os
from dataclasses import dataclass
from functools import lru_cache


class MissingEnvironmentError(Exception):
    """Raised when a required environment variable is missing."""

    def __init__(self, var_name: str):
        super().__init__(f"MISSING_ENV: {var_name}")
        self.var_name = var_name


@dataclass(frozen=True)
class Settings:
    """Application settings from environment variables."""

    database_url: str
    app_env: str = "development"

    @classmethod
    def load(cls) -> "Settings":
        """Load settings from environment, raising named errors on missing required vars."""
        database_url = os.environ.get("DATABASE_URL")
        if not database_url:
            raise MissingEnvironmentError("DATABASE_URL")
        return cls(
            database_url=database_url,
            app_env=os.environ.get("APP_ENV", "development"),
        )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Lazily load and cache settings — importing modules never requires env; startup does."""
    return Settings.load()
