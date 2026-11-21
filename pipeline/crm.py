"""Read-only CRM client.

The pipeline can only *read* the CRM: this class exposes GET methods and nothing else. Every write happens in the
review app's executor, after a human approves a case. That makes "nothing writes without approval" a property of
the code, not a convention.
"""
from __future__ import annotations

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

PAGE_SIZE = 100


class ReadOnlyCRM:
    def __init__(self, base_url: str, token: str, timeout: float = 30.0):
        if not token:
            raise ValueError("CRM_API_TOKEN is not set (add it to .env)")
        self.base = base_url.rstrip("/")
        self.timeout = timeout
        self.s = requests.Session()
        self.s.headers.update({"Authorization": f"Bearer {token}", "Accept": "application/json"})
        # Exponential backoff on throttling / transient server errors. GET only, so retries are always safe.
        retry = Retry(total=5, backoff_factor=0.5, status_forcelist=(429, 500, 502, 503, 504),
                      allowed_methods=frozenset({"GET"}), respect_retry_after_header=True)
        self.s.mount("https://", HTTPAdapter(max_retries=retry))
        self.s.mount("http://", HTTPAdapter(max_retries=retry))

    def _get(self, path: str, **params) -> dict | list:
        r = self.s.get(f"{self.base}{path}", params=params or None, timeout=self.timeout)
        r.raise_for_status()
        return r.json()

    def _all(self, path: str, **params) -> list[dict]:
        items: list[dict] = []
        page = 1
        while True:
            body = self._get(path, page=page, page_size=PAGE_SIZE, **params)
            batch = body.get("data", []) if isinstance(body, dict) else body
            items.extend(batch)
            total = body.get("total") if isinstance(body, dict) else None
            if not batch or (total is not None and len(items) >= total) or len(batch) < PAGE_SIZE:
                return items
            page += 1

    def me(self) -> dict:
        return self._get("/me")

    def accounts(self) -> list[dict]:
        return self._all("/accounts")

    def account(self, account_id: str) -> dict:
        return self._get(f"/accounts/{account_id}")

    def contacts(self) -> list[dict]:
        return self._all("/contacts")
