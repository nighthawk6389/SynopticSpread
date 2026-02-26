"""Alert checking logic — called after metric computation in the scheduler."""

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.alert import AlertEvent, AlertRule
from app.models.divergence import PointMetric

logger = logging.getLogger(__name__)


def _get_metric_value(metric: str, spread: float, rmse: float, bias: float) -> float:
    if metric == "spread":
        return spread
    if metric == "rmse":
        return rmse
    if metric == "bias":
        return bias
    return spread


def _threshold_exceeded(value: float, threshold: float, comparison: str) -> bool:
    if comparison == "gt":
        return value > threshold
    if comparison == "lt":
        return value < threshold
    return False


async def check_alerts(
    db: AsyncSession,
    variable: str,
    lat: float,
    lon: float,
    lead_hour: int,
    spread: float,
    rmse: float,
    bias: float,
    location_label: str | None = None,
) -> list[AlertEvent]:
    """Check all enabled alert rules against the given metric values.

    Creates AlertEvent rows for any triggered rules and optionally sends
    webhook notifications.
    """
    # Find matching rules
    stmt = select(AlertRule).where(
        AlertRule.enabled == True,  # noqa: E712
        AlertRule.variable == variable,
    )
    result = await db.execute(stmt)
    rules = result.scalars().all()

    triggered: list[AlertEvent] = []

    for rule in rules:
        # If rule is location-specific, check proximity
        if rule.lat is not None and rule.lon is not None:
            if abs(rule.lat - lat) > 0.5 or abs(rule.lon - lon) > 0.5:
                continue

        value = _get_metric_value(rule.metric, spread, rmse, bias)

        if not _threshold_exceeded(value, rule.threshold, rule.comparison):
            continue

        # For consecutive_hours > 1, check recent metrics
        if rule.consecutive_hours > 1:
            recent_stmt = (
                select(PointMetric)
                .where(
                    PointMetric.variable == variable,
                    PointMetric.lat.between(lat - 0.5, lat + 0.5),
                    PointMetric.lon.between(lon - 0.5, lon + 0.5),
                )
                .order_by(PointMetric.created_at.desc())
                .limit(rule.consecutive_hours)
            )
            recent = await db.execute(recent_stmt)
            recent_metrics = recent.scalars().all()

            if len(recent_metrics) < rule.consecutive_hours:
                continue

            all_exceeded = all(
                _threshold_exceeded(
                    _get_metric_value(rule.metric, m.spread, m.rmse, m.bias),
                    rule.threshold,
                    rule.comparison,
                )
                for m in recent_metrics
            )
            if not all_exceeded:
                continue

        event = AlertEvent(
            rule_id=rule.id,
            value=value,
            variable=variable,
            lat=lat,
            lon=lon,
            location_label=location_label,
            lead_hour=lead_hour,
        )
        db.add(event)
        triggered.append(event)

    if triggered:
        await db.flush()
        logger.info(
            "Triggered %d alert(s) for %s at (%.2f, %.2f) fhr=%d",
            len(triggered),
            variable,
            lat,
            lon,
            lead_hour,
        )

        # Send webhook notification if configured
        await _send_webhook(triggered)

    return triggered


async def _send_webhook(events: list[AlertEvent]) -> None:
    """Send webhook notification for triggered alerts."""
    from app.config import settings

    if not settings.alert_webhook_url:
        return

    try:
        import httpx

        payload = {
            "text": f"SynopticSpread: {len(events)} alert(s) triggered",
            "alerts": [
                {
                    "variable": e.variable,
                    "value": e.value,
                    "lat": e.lat,
                    "lon": e.lon,
                    "location": e.location_label,
                    "lead_hour": e.lead_hour,
                }
                for e in events
            ],
        }
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(settings.alert_webhook_url, json=payload)
    except Exception:
        logger.warning("Failed to send alert webhook", exc_info=True)
