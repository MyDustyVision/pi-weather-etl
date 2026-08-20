"""
============================================================
AWS Lambda - Sensor Data Reader API
============================================================
Serves GET requests for the visualization dashboard.
Add these routes to your existing API Gateway:

  GET /readings?hours=24&device_id=pi-001
  GET /stats?days=7&device_id=pi-001

Environment variables (same as lambda_function.py):
  DATABASE_URL — Neon PostgreSQL connection string
============================================================
"""

import json
import logging
import os

import psycopg2
from psycopg2.extras import RealDictCursor

log = logging.getLogger()
log.setLevel(logging.INFO)

_db_conn = None

CORS_HEADERS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}


def get_db():
    global _db_conn
    if _db_conn is None or _db_conn.closed:
        _db_conn = psycopg2.connect(
            os.environ["DATABASE_URL"],
            connect_timeout=5,
            options="-c statement_timeout=15000",
        )
    return _db_conn


def respond(status: int, body: dict) -> dict:
    return {
        "statusCode": status,
        "headers": CORS_HEADERS,
        "body": json.dumps(body, default=str),  # default=str handles datetime serialization
    }


# ── Route: GET /readings ──────────────────────────────────────

def get_readings(params: dict) -> dict:
    """
    Returns time-series readings for charting.

    Query params:
      hours      — lookback window (default: 24, max: 168)
      device_id  — filter by device (default: all)
      limit      — max rows returned (default: 500)
    """
    hours     = min(int(params.get("hours", 24)), 168)   # Cap at 7 days
    device_id = params.get("device_id")
    limit     = min(int(params.get("limit", 500)), 2000)

    sql = """
        SELECT
            id,
            recorded_at,
            temp_c,
            temp_f,
            pressure_hpa,
            pressure_inhg,
            humidity_pct,
            dew_point_c,
            device_id,
            location
        FROM sensor_readings
        WHERE recorded_at >= NOW() - (%(hours)s || ' hours')::INTERVAL
          AND (%(device_id)s IS NULL OR device_id = %(device_id)s)
        ORDER BY recorded_at ASC
        LIMIT %(limit)s;
    """

    conn = get_db()
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(sql, {"hours": hours, "device_id": device_id, "limit": limit})
        rows = cur.fetchall()

    return respond(200, {
        "count":   len(rows),
        "hours":   hours,
        "readings": [dict(r) for r in rows],
    })


# ── Route: GET /stats ─────────────────────────────────────────

def get_stats(params: dict) -> dict:
    """
    Returns aggregated statistics for the summary panel.

    Query params:
      days       — lookback window (default: 7, max: 30)
      device_id  — filter by device (default: all)
    """
    days      = min(int(params.get("days", 7)), 30)
    device_id = params.get("device_id")

    # Latest single reading
    latest_sql = """
        SELECT temp_c, temp_f, pressure_hpa, pressure_inhg, recorded_at, device_id, location
        FROM sensor_readings
        WHERE (%(device_id)s IS NULL OR device_id = %(device_id)s)
        ORDER BY recorded_at DESC
        LIMIT 1;
    """

    # Overall stats for the time window
    summary_sql = """
        SELECT
            COUNT(*)                              AS total_readings,
            ROUND(AVG(temp_c)::NUMERIC, 2)        AS avg_temp_c,
            ROUND(MIN(temp_c)::NUMERIC, 2)        AS min_temp_c,
            ROUND(MAX(temp_c)::NUMERIC, 2)        AS max_temp_c,
            ROUND(AVG(temp_f)::NUMERIC, 2)        AS avg_temp_f,
            ROUND(MIN(temp_f)::NUMERIC, 2)        AS min_temp_f,
            ROUND(MAX(temp_f)::NUMERIC, 2)        AS max_temp_f,
            ROUND(AVG(pressure_hpa)::NUMERIC, 2)  AS avg_pressure_hpa,
            ROUND(MIN(pressure_hpa)::NUMERIC, 2)  AS min_pressure_hpa,
            ROUND(MAX(pressure_hpa)::NUMERIC, 2)  AS max_pressure_hpa,
            ROUND(AVG(humidity_pct)::NUMERIC, 2)  AS avg_humidity_pct,
            ROUND(MIN(humidity_pct)::NUMERIC, 2)  AS min_humidity_pct,
            ROUND(MAX(humidity_pct)::NUMERIC, 2)  AS max_humidity_pct
        FROM sensor_readings
        WHERE recorded_at >= NOW() - (%(days)s || ' days')::INTERVAL
          AND (%(device_id)s IS NULL OR device_id = %(device_id)s);
    """

    # Daily averages (for the sparkline trend)
    daily_sql = """
        SELECT
            DATE(recorded_at)                     AS day,
            ROUND(AVG(temp_c)::NUMERIC, 2)        AS avg_temp_c,
            ROUND(MIN(temp_c)::NUMERIC, 2)        AS min_temp_c,
            ROUND(MAX(temp_c)::NUMERIC, 2)        AS max_temp_c,
            ROUND(AVG(pressure_hpa)::NUMERIC, 2)  AS avg_pressure_hpa,
            COUNT(*)                              AS readings
        FROM sensor_readings
        WHERE recorded_at >= NOW() - (%(days)s || ' days')::INTERVAL
          AND (%(device_id)s IS NULL OR device_id = %(device_id)s)
        GROUP BY DATE(recorded_at)
        ORDER BY day ASC;
    """

    args = {"device_id": device_id, "days": days}
    conn = get_db()

    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(latest_sql, {"device_id": device_id})
        latest = dict(cur.fetchone() or {})

        cur.execute(summary_sql, args)
        summary = dict(cur.fetchone() or {})

        cur.execute(daily_sql, args)
        daily = [dict(r) for r in cur.fetchall()]

    return respond(200, {
        "latest":  latest,
        "summary": summary,
        "daily":   daily,
        "days":    days,
    })


# ── Lambda Handler ────────────────────────────────────────────

def lambda_handler(event, context):
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS_HEADERS, "body": ""}

    path   = event.get("rawPath") or event.get("path", "")
    params = event.get("queryStringParameters") or {}

    try:
        if path.endswith("/readings"):
            return get_readings(params)
        elif path.endswith("/stats"):
            return get_stats(params)
        else:
            return respond(404, {"error": f"Unknown route: {path}"})

    except psycopg2.Error as e:
        log.error(f"DB error: {e}")
        return respond(503, {"error": "Database unavailable"})
    except Exception as e:
        log.error(f"Unexpected error: {e}", exc_info=True)
        return respond(500, {"error": "Internal server error"})
