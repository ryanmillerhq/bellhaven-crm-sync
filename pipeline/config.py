"""Settings loaded from the repo-root .env (locally) or real environment variables (CI / hosting)."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(REPO_ROOT / ".env")


@dataclass(frozen=True)
class Settings:
    site_base_url: str
    crm_base_url: str
    crm_api_token: str
    database_url: str


def get_settings() -> Settings:
    return Settings(
        site_base_url=os.getenv("SITE_BASE_URL", "https://analyst-assessment-production.up.railway.app").rstrip("/"),
        crm_base_url=os.getenv("CRM_BASE_URL", "https://analyst-assessment-production.up.railway.app/api/v1").rstrip("/"),
        crm_api_token=os.getenv("CRM_API_TOKEN", ""),
        database_url=os.getenv("DATABASE_URL", ""),
    )
