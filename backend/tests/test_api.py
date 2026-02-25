"""Smoke tests for the FastAPI application."""

import pytest
from httpx import ASGITransport, AsyncClient


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
async def client():
    # Import app with scheduler disabled to avoid DB dependency
    import os

    os.environ["SCHEDULER_ENABLED"] = "false"
    os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///test.db"

    from app.main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.mark.anyio
async def test_health(client: AsyncClient):
    resp = await client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


@pytest.mark.anyio
async def test_variables(client: AsyncClient):
    resp = await client.get("/api/variables")
    assert resp.status_code == 200
    data = resp.json()
    assert "precip" in data
    assert "wind_speed" in data
