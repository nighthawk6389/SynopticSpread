"""Shared pytest fixtures for integration tests.

Patches ``sqlalchemy.dialects.postgresql.ARRAY`` at module-load time so that
``ModelRun.forecast_hours`` is stored as a JSON text column instead of a
native PostgreSQL array.  This lets the full ORM + router stack run against
an in-memory SQLite database with no external services required.

The patch is guarded by a sentinel attribute so it is applied only once per
Python process even when pytest re-imports the file.
"""

import json
import os

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import Text, TypeDecorator
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

# ---------------------------------------------------------------------------
# Patch ARRAY → JSON-backed TypeDecorator (must run before any app import)
# ---------------------------------------------------------------------------


class _ArrayAsJSON(TypeDecorator):
    """Stores integer lists as a JSON text string – SQLite-compatible."""

    impl = Text
    cache_ok = True

    def process_bind_param(self, value, dialect):
        return json.dumps(value) if value is not None else None

    def process_result_value(self, value, dialect):
        return json.loads(value) if value is not None else None


import sqlalchemy.dialects.postgresql as _psql  # noqa: E402

if not getattr(_psql, "_test_array_patched", False):
    _psql.ARRAY = lambda *args, **kwargs: _ArrayAsJSON()
    _psql._test_array_patched = True

# Disable the scheduler so importing app.main never tries to connect.
os.environ.setdefault("SCHEDULER_ENABLED", "false")


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
async def db() -> AsyncSession:
    """Yield an AsyncSession backed by a fresh in-memory SQLite database.

    All ORM tables are created before the test and the engine is disposed
    afterwards, giving each test a clean slate.
    """
    from app.database import Base

    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
    )

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    factory = async_sessionmaker(engine, expire_on_commit=False)

    async with factory() as session:
        yield session

    await engine.dispose()


@pytest.fixture
async def http_client(db: AsyncSession):
    """AsyncClient pointed at the FastAPI app with ``get_db`` wired to the
    in-memory SQLite session created by the ``db`` fixture.

    Because pytest deduplicates fixture instances within the same test, any
    test that requests both ``http_client`` and ``db`` will share the same
    session – so data inserted via ``db`` is immediately visible to the
    handler that runs when the client fires a request.
    """
    from app.database import get_db
    from app.main import app

    async def _override():
        yield db

    app.dependency_overrides[get_db] = _override
    transport = ASGITransport(app=app)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client

    app.dependency_overrides.pop(get_db, None)
