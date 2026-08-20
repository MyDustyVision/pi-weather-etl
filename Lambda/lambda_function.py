"""
============================================================
AWS Lambda - Sensor ETL Function
============================================================
Triggered by API Gateway HTTP POST.
Extracts sensor data, transforms units, loads to Neon PostgreSQL.

Environment variables required (set in Lambda console):
  DATABASE_URL  — Neon connection string
                  e.g. postgresql://user:pass@host.neon.tech/neondb?sslmode=require

Dependencies (bundle as a Lambda Layer or zip):
  psycopg2-binary==2.9.9
============================================================
"""

import json
import logging
import os
from datetime import datetime, timezone

import psycopg2
from psycopg2.extras import RealDictCursor

# ── Logging ──────────────────────────────────────────────────
log = logging.getLogger()
log.setLevel(logging.INFO)

# ── Database connection (reused across warm Lambda invocations) ──
_db_conn = None

def get_db_connection():
    """Return a cached PostgreSQL connection, reconnecting if needed."""
    global _db_conn
    try:
        if _db_conn is None or _db_conn.closed:
            _db_conn = psycopg2.connect(
                os.environ["DATABASE_URL"],
                connect_timeout=5,
                options="-c statement_timeout=10000",  # 10s query timeout
            )
            log.info("New DB connection established")
    except Exception as e:
        log.error(f"DB connection failed: {e}")
        raise
    return _db_conn


# ── ETL Functions ─────────────────────────────────────────────

def extract(event: dict) -> dict:
    """
    Extract: parse and validate the incoming API Gateway payload.
    Raises ValueError for malformed or missing data.
    """
    try:
        body = json.loads(event.get("body", "{}"))
    except json.JSONDecodeError as e:
        raise ValueError(f"Invalid JSON body: {e}")

    required = ["temperature_c", "pressure_hpa", "humidity_pct", "timestamp"]
    missing = [field for field in required if field not in body]
    if missing:
        raise ValueError(f"Missing required fields: {missing}")

    # Validate types
    try:
        float(body["temperature_c"])
        float(body["pressure_hpa"])
        float(body["humidity_pct"])
    except (TypeError, ValueError):
        raise ValueError("temperature_c, pressure_hpa, and humidity_pct must be numeric")

    # Validate timestamp is parseable
    try:
        datetime.fromisoformat(body["timestamp"].replace("Z", "+00:00"))
    except ValueError:
        raise ValueError(f"Invalid timestamp format: {body['timestamp']}")

    return body


def transform(raw: dict) -> dict:
    """
    Transform: convert units and validate ranges.
    Returns a clean record ready for database insertion.
    """
    temp_c       = float(raw["temperature_c"])
    pressure_hpa = float(raw["pressure_hpa"])
    humidity_pct = float(raw["humidity_pct"])

    # Sanity-check sensor ranges (catches sensor faults or bad data)
    if not (-40 <= temp_c <= 85):
        raise ValueError(f"Temperature out of range: {temp_c}°C")
    if not (260 <= pressure_hpa <= 1260):
        raise ValueError(f"Pressure out of range: {pressure_hpa} hPa")
    if not (0 <= humidity_pct <= 100):
        raise ValueError(f"Humidity out of range: {humidity_pct}%")

    # Unit conversions
    temp_f        = round((temp_c * 9 / 5) + 32, 2)
    pressure_inhg = round(pressure_hpa * 0.02953, 4)

    # Derived: dew point (Magnus formula) — useful for condensation risk
    import math
    a, b = 17.625, 243.04
    gamma      = (a * temp_c / (b + temp_c)) + math.log(humidity_pct / 100.0)
    dew_point_c = round((b * gamma) / (a - gamma), 2)

    return {
        "recorded_at":   raw["timestamp"],
        "temp_c":        round(temp_c, 2),
        "temp_f":        temp_f,
        "pressure_hpa":  round(pressure_hpa, 2),
        "pressure_inhg": pressure_inhg,
        "humidity_pct":  round(humidity_pct, 2),
        "dew_point_c":   dew_point_c,
        "device_id":     raw.get("device_id", "pi-001"),
        "location":      raw.get("location") or None,
    }


def load(record: dict) -> int:
    """
    Load: insert the transformed record into PostgreSQL.
    Returns the new row's ID.
    """
    sql = """
        INSERT INTO sensor_readings
            (recorded_at, temp_c, temp_f, pressure_hpa, pressure_inhg,
             humidity_pct, dew_point_c, device_id, location)
        VALUES
            (%(recorded_at)s, %(temp_c)s, %(temp_f)s,
             %(pressure_hpa)s, %(pressure_inhg)s,
             %(humidity_pct)s, %(dew_point_c)s, %(device_id)s, %(location)s)
        RETURNING id;
    """
    conn = get_db_connection()
    with conn.cursor() as cur:
        cur.execute(sql, record)
        row_id = cur.fetchone()[0]
        conn.commit()

    log.info(
        f"Inserted row {row_id}: "
        f"{record['temp_c']}°C / {record['temp_f']}°F | "
        f"{record['pressure_hpa']} hPa / {record['pressure_inhg']} inHg | "
        f"{record['humidity_pct']}% RH | dew {record['dew_point_c']}°C"
    )
    return row_id


# ── Lambda Handler ────────────────────────────────────────────

def lambda_handler(event, context):
    """Main entry point — orchestrates Extract → Transform → Load."""

    # CORS headers (allows browser-based dashboards to query the API)
    headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
    }

    # Handle CORS preflight
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": headers, "body": ""}

    try:
        # ── Extract ──
        raw = extract(event)
        log.info(f"Extracted: device={raw.get('device_id')}, ts={raw['timestamp']}")

        # ── Transform ──
        record = transform(raw)
        log.info(f"Transformed: {record['temp_c']}°C → {record['temp_f']}°F")

        # ── Load ──
        row_id = load(record)

        return {
            "statusCode": 201,
            "headers": headers,
            "body": json.dumps({
                "status":        "ok",
                "id":            row_id,
                "temp_f":        record["temp_f"],
                "pressure_inhg": record["pressure_inhg"],
                "humidity_pct":  record["humidity_pct"],
                "dew_point_c":   record["dew_point_c"],
            }),
        }

    except ValueError as e:
        log.warning(f"Validation error: {e}")
        return {
            "statusCode": 400,
            "headers": headers,
            "body": json.dumps({"status": "error", "message": str(e)}),
        }
    except psycopg2.Error as e:
        log.error(f"Database error: {e}")
        return {
            "statusCode": 503,
            "headers": headers,
            "body": json.dumps({"status": "error", "message": "Database unavailable"}),
        }
    except Exception as e:
        log.error(f"Unexpected error: {e}", exc_info=True)
        return {
            "statusCode": 500,
            "headers": headers,
            "body": json.dumps({"status": "error", "message": "Internal server error"}),
        }
