"""Config and a thin async client for the review app's JSON API.

Shapes follow web/app/api/**/route.ts. This module holds no business rules: every decision is executed by the
review app (web/lib/cases.ts → executor.ts), never here.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

import httpx

DEFAULT_REVIEW_APP_URL = "http://localhost:3210"
TIMEOUT_S = 120.0  # an approval can make several CRM calls in a row


@dataclass(frozen=True)
class Settings:
    review_app_url: str
    reviewer: str | None
    passcode: str | None

    @classmethod
    def from_env(cls) -> Settings:
        return cls(
            review_app_url=(os.getenv("REVIEW_APP_URL") or DEFAULT_REVIEW_APP_URL).strip().rstrip("/"),
            reviewer=(os.getenv("REVIEWER") or "").strip() or None,
            passcode=os.getenv("REVIEW_PASSCODE") or None,
        )


class ReviewAppError(Exception):
    """The review app answered with an error status, or could not be reached."""

    def __init__(self, message: str, *, status: int | None = None, code: str | None = None, body: Any = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.body = body


class ReviewApp:
    def __init__(self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None):
        self.settings = settings
        self._transport = transport

    # ------------------------------------------------------------------ plumbing

    def _write_headers(self) -> dict[str, str]:
        if not self.settings.reviewer:
            raise ReviewAppError("REVIEWER is not set; refusing to write.")
        headers = {"x-reviewer": self.settings.reviewer}
        if self.settings.passcode:
            headers["x-review-passcode"] = self.settings.passcode
        return headers

    async def _request(
        self, method: str, path: str, *, params: dict[str, str] | None = None, body: dict[str, Any] | None = None,
        write: bool = False, accept: tuple[int, ...] = (200,),
    ) -> tuple[int, dict[str, Any]]:
        url = self.settings.review_app_url
        headers = {"accept": "application/json", **(self._write_headers() if write else {})}
        try:
            async with httpx.AsyncClient(base_url=url, transport=self._transport, timeout=TIMEOUT_S) as http:
                resp = await http.request(method, path, params=params, json=body, headers=headers)
        except httpx.TimeoutException as e:
            raise ReviewAppError(f"The review app at {url} did not answer within {TIMEOUT_S:.0f}s ({type(e).__name__}).") from e
        except httpx.TransportError as e:
            raise ReviewAppError(
                f"Could not reach the review app at {url} ({type(e).__name__}). Is it running? "
                "Start it with `cd web && npx next dev -p 3210`, or point REVIEW_APP_URL at it."
            ) from e
        try:
            data = resp.json()
        except ValueError:
            data = {"error": resp.text.strip()[:300] or f"HTTP {resp.status_code}"}
        if not isinstance(data, dict):
            data = {"data": data}
        if resp.status_code not in accept:
            raise ReviewAppError(
                f"{data.get('error') or 'Request failed'} (HTTP {resp.status_code})",
                status=resp.status_code, code=data.get("code"), body=data,
            )
        return resp.status_code, data

    async def _get(self, path: str, params: dict[str, str] | None = None) -> dict[str, Any]:
        return (await self._request("GET", path, params=params))[1]

    # ------------------------------------------------------------------ reads

    async def progress(self) -> dict[str, Any]:
        return (await self._get("/api/progress"))["progress"]

    async def runs(self, limit: int = 10) -> list[dict[str, Any]]:
        return (await self._get("/api/runs", {"limit": str(limit)}))["runs"]

    async def cases(self, status: str | None = None, kind: str | None = None) -> list[dict[str, Any]]:
        params = {k: v for k, v in {"status": status, "kind": kind}.items() if v}
        return (await self._get("/api/cases", params or None))["cases"]

    async def case(self, case_id: int) -> dict[str, Any]:
        return (await self._get(f"/api/cases/{int(case_id)}"))["case"]

    async def search_accounts(self, q: str) -> list[dict[str, Any]]:
        return (await self._get("/api/crm/accounts", {"q": q}))["accounts"]

    async def account(self, account_id: str) -> dict[str, Any]:
        return await self._get(f"/api/crm/accounts/{quote(account_id.strip(), safe='')}")

    # ------------------------------------------------------------------ writes (need REVIEWER)

    async def approve(
        self, case_id: int, *, edits: dict[str, dict[str, str]], note: str | None, expected_updated_at: str | None,
    ) -> tuple[int, dict[str, Any]]:
        """200 = applied; 422 = stale or failed (body still has the case). Other statuses raise ReviewAppError."""
        body: dict[str, Any] = {"edits": edits, "expected_updated_at": expected_updated_at}
        if note:
            body["note"] = note
        return await self._request("POST", f"/api/cases/{int(case_id)}/approve", body=body, write=True, accept=(200, 422))

    async def reject(self, case_id: int, reason: str | None) -> dict[str, Any]:
        _, data = await self._request("POST", f"/api/cases/{int(case_id)}/reject", body={"reason": reason}, write=True)
        return data["case"]

    async def reopen(self, case_id: int) -> dict[str, Any]:
        _, data = await self._request("POST", f"/api/cases/{int(case_id)}/reopen", body={}, write=True)
        return data["case"]
