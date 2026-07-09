"""Tests for configuration module."""
import pytest
from pdi_engine.config import Settings, MissingEnvironmentError


def test_missing_database_url_raises_error(monkeypatch):
    """Test that missing DATABASE_URL raises MissingEnvironmentError."""
    monkeypatch.delenv("DATABASE_URL", raising=False)

    with pytest.raises(MissingEnvironmentError) as exc_info:
        Settings.load()

    assert str(exc_info.value) == "MISSING_ENV: DATABASE_URL"
    assert exc_info.value.var_name == "DATABASE_URL"


def test_settings_load_with_database_url(monkeypatch):
    """Test that settings load successfully when DATABASE_URL is set."""
    test_db_url = "postgresql://localhost/testdb"
    monkeypatch.setenv("DATABASE_URL", test_db_url)
    monkeypatch.delenv("APP_ENV", raising=False)

    settings = Settings.load()

    assert settings.database_url == test_db_url
    assert settings.app_env == "development"


def test_app_env_defaults_to_development(monkeypatch):
    """Test that APP_ENV defaults to 'development' when not set."""
    test_db_url = "postgresql://localhost/testdb"
    monkeypatch.setenv("DATABASE_URL", test_db_url)
    monkeypatch.delenv("APP_ENV", raising=False)

    settings = Settings.load()

    assert settings.app_env == "development"


def test_app_env_reads_from_environment(monkeypatch):
    """Test that APP_ENV is read from environment when set."""
    test_db_url = "postgresql://localhost/testdb"
    monkeypatch.setenv("DATABASE_URL", test_db_url)
    monkeypatch.setenv("APP_ENV", "production")

    settings = Settings.load()

    assert settings.app_env == "production"
