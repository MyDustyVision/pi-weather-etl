#!/usr/bin/env python3
"""
============================================================
Raspberry Pi Sense HAT - Sensor Data Collector
============================================================
Reads temperature and pressure from the Sense HAT and
POSTs the data to the AWS API Gateway endpoint.

Scheduled via cron to run every 5 minutes.
Install dependencies: pip3 install requests sense-hat
============================================================
"""

import json
import logging
import os
import sys
from datetime import datetime, timezone
from dotenv import load_dotenv
load_dotenv()  # loads .env file if present, falls back to system env vars

import requests
from sense_hat import SenseHat

# ── Configuration ────────────────────────────────────────────
API_URL   = os.environ.get("API_URL", "https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/prod/ingest")
API_KEY   = os.environ.get("API_KEY", "")          # Optional: API Gateway key
DEVICE_ID = os.environ.get("DEVICE_ID", "pi-001")  # Unique ID if you have multiple Pis
LOCATION  = os.environ.get("LOCATION", "")         # e.g. "living_room"
TIMEOUT   = 10                                      # HTTP request timeout in seconds

# ── Logging ──────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler("/home/pi/sensor_collector.log"),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger(__name__)


def read_sensors(hat: SenseHat) -> dict:
    """
    Read raw sensor values from the Sense HAT.
    The Sense HAT temperature sensor runs warm due to the Pi's CPU heat.
    A correction factor of -5°C is commonly applied; tune to your setup.
    """
    raw_temp     = hat.get_temperature()                 # From humidity sensor (HTS221)
    raw_temp_p   = hat.get_temperature_from_pressure()   # From pressure sensor (LPS25H)
    raw_pressure = hat.get_pressure()                    # hPa
    raw_humidity = hat.get_humidity()                    # % relative humidity (HTS221)

    # Average the two temperature sources for better accuracy
    avg_temp = (raw_temp + raw_temp_p) / 2

    # Apply CPU heat correction (adjust this value for your environment)
    # Note: CPU heat also affects humidity readings slightly; correct temp first
    cpu_correction = -5.0
    corrected_temp = avg_temp + cpu_correction

    return {
        "temperature_c": round(corrected_temp, 2),
        "pressure_hpa":  round(raw_pressure, 2),
        "humidity_pct":  round(raw_humidity, 2),   # 0–100 % RH
        "timestamp":     datetime.now(timezone.utc).isoformat(),
        "device_id":     DEVICE_ID,
        "location":      LOCATION,
    }


def send_to_lambda(payload: dict) -> bool:
    """POST sensor payload to the AWS API Gateway endpoint."""
    headers = {"Content-Type": "application/json"}
    if API_KEY:
        headers["x-api-key"] = API_KEY

    try:
        response = requests.post(
            API_URL,
            headers=headers,
            data=json.dumps(payload),
            timeout=TIMEOUT,
        )
        response.raise_for_status()
        log.info(f"✓ Sent: {payload['temperature_c']}°C | {payload['pressure_hpa']} hPa → {response.status_code}")
        return True

    except requests.exceptions.ConnectionError:
        log.error("✗ Network error — is the Pi connected to the internet?")
    except requests.exceptions.Timeout:
        log.error(f"✗ Request timed out after {TIMEOUT}s")
    except requests.exceptions.HTTPError as e:
        log.error(f"✗ HTTP error: {e.response.status_code} — {e.response.text}")
    except Exception as e:
        log.error(f"✗ Unexpected error: {e}")

    return False


def main():
    log.info("── Sensor collection started ──")

    hat = SenseHat()
    hat.clear()  # Turn off the LED matrix to save power

    payload = read_sensors(hat)
    log.info(f"Read: temp={payload['temperature_c']}°C, pressure={payload['pressure_hpa']}hPa")

    success = send_to_lambda(payload)
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
