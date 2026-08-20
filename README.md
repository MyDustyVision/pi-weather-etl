# 🥧 Pi Weather ETL Pipeline
> A end-to-end data engineering pipeline that collects real-time attic environmental data using a Raspberry Pi Sense HAT, processes it through AWS Lambda, stores it in PostgreSQL, and visualizes it through Grafana.

---

## 📸 Dashboard Preview

![Grafana Dashboard](docs/grafanapi.png)

---

## 🏗️ Architecture

```
┌─────────────────────┐
│  Raspberry Pi 5     │
│  + Sense HAT        │
│  (Attic Crawlspace) │
│                     │
│  • Temperature      │
│  • Pressure         │
│  • Humidity         │
└────────┬────────────┘
         │ HTTPS POST
         │ every 30 min
         ▼
┌─────────────────────┐
│   AWS API Gateway   │
│   HTTP API          │
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐     ┌─────────────────────┐
│  AWS Lambda         │     │  AWS Lambda         │
│  sensor-etl         │     │  sensor-reader      │
│  (Writer)           │     │  (Reader)           │
│                     │     │                     │
│  • Extract          │     │  • GET /readings    │
│  • Transform        │     │  • GET /stats       │
│  • Load             │     │                     │
└────────┬────────────┘     └──────────┬──────────┘
         │                             │
         ▼                             │
┌─────────────────────┐               │
│  Neon PostgreSQL    │◄──────────────┘
│  (Free Tier)        │
│                     │
│  sensor_readings    │
└────────┬────────────┘
         │
         ├──────────────────────────────────┐
         ▼                                  ▼
┌─────────────────────┐        ┌────────────────────┐
│  Grafana Cloud      │        │  ntfy.sh Alerts    │
│  (Time Series)      │        │  (Phone Push)      │
└─────────────────────┘        └────────────────────┘
```

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Hardware | Raspberry Pi 5, Sense HAT (HTS221, LPS25H) |
| Data Collection | Python 3, cron |
| ETL | AWS Lambda (Python 3.11) |
| API | AWS API Gateway (HTTP API) |
| Database | Neon PostgreSQL (Serverless) |
| Monitoring | AWS CloudWatch |
| Visualization | Grafana Cloud |
| Alerting | ntfy.sh (push notifications) |
| Version Control | Git + GitHub |

---

## 📊 Data Collected

| Metric | Source | Unit | Derived |
|--------|--------|------|---------|
| Temperature | HTS221 + LPS25H avg | °C / °F | No |
| Barometric Pressure | LPS25H | hPa / inHg | No |
| Relative Humidity | HTS221 | % RH | No |
| Dew Point | Calculated | °C | Yes (Magnus formula) |

---

## ✨ Features

- **Automated collection** every 30 minutes via cron
- **ETL pipeline** — extracts raw sensor data, transforms units and derives dew point, loads to PostgreSQL
- **Dual unit display** — both metric and imperial stored and displayed
- **Rain prediction** — analyzes 3-hour pressure trends and humidity to predict precipitation
- **Phone alerts** via ntfy.sh for:
  - Humidity spike (>15% in 30 min) — possible roof leak
  - Critical humidity (>85%) — water intrusion
  - Temperature spike (>10°C in 30 min) — possible fire
  - Critical temperature (>60°C) — fire risk
- **Remote dashboard** accessible from any device anywhere
- **Grafana integration** for professional time series visualization

---

## 🗄️ Database Schema

```sql
CREATE TABLE sensor_readings (
    id              SERIAL PRIMARY KEY,
    recorded_at     TIMESTAMPTZ NOT NULL,
    received_at     TIMESTAMPTZ DEFAULT NOW(),
    temp_c          NUMERIC(5, 2) NOT NULL,
    temp_f          NUMERIC(5, 2) NOT NULL,
    pressure_hpa    NUMERIC(7, 2) NOT NULL,
    pressure_inhg   NUMERIC(6, 4) NOT NULL,
    humidity_pct    NUMERIC(5, 2) NOT NULL,
    dew_point_c     NUMERIC(5, 2),
    device_id       VARCHAR(64) DEFAULT 'pi-001',
    location        VARCHAR(128)
);
```

---

## 🚀 Setup

### Prerequisites
- Raspberry Pi 4/5 with Sense HAT
- AWS account (free tier)
- Neon account (free tier)
- Netlify account (free tier)
- Grafana Cloud account (free tier)

### 1. Database
```bash
# Run schema in Neon SQL Editor
psql $DATABASE_URL -f database/schema.sql
```

### 2. Lambda Functions
```bash
# Deploy writer Lambda
cd lambda
bash deploy_lambda.sh

# Set database URL
aws lambda update-function-configuration \
  --function-name sensor-etl \
  --environment "Variables={DATABASE_URL=your_neon_connection_string}" \
  --region us-east-1
```

### 3. Raspberry Pi
```bash
# Copy collector to Pi
scp raspberry_pi/collector.py user@raspberrypi.local:/home/user/

# Configure environment
cp .env.example .env
nano .env  # add your API URL and settings

# Set up cron (every 30 minutes)
crontab -e
# Add: */30 * * * * /bin/bash -c 'source ~/.sensor_env && python3 ~/collector.py >> ~/sensor_collector.log 2>&1'
```

### 4. Grafana
1. Create free account at grafana.com
2. Add PostgreSQL data source using Neon connection details
3. Import dashboard and start visualizing

---

## 📁 Project Structure

```
pi-weather-etl/
├── raspberry_pi/
│   ├── collector.py        # Sensor reading + HTTP POST
│   └── pi_setup.sh         # Pi setup automation
├── lambda/
│   ├── lambda_function.py  # ETL writer function
│   ├── lambda_reader.py    # Data reader function
│   └── deploy_lambda.sh    # Deployment script
├── database/
│   └── schema.sql          # PostgreSQL schema + views
├── .env.example            # Environment variable template
├── .gitignore
└── README.md
```

---

## 💰 Cost Breakdown

| Service | Cost |
|---------|------|
| Raspberry Pi 5 + Sense HAT | ~$93 one-time |
| AWS Lambda | $0/month (free tier) |
| AWS API Gateway | $0/month (free tier) |
| Neon PostgreSQL | $0/month (free tier) |
| Netlify | $0/month (free tier) |
| ntfy.sh alerts | $0/month |
| Electricity (~3W) | ~$2-3/month |
| **Total ongoing** | **~$2-3/month** |

---

## 🔧 Environment Variables

Copy `.env.example` to `.env` and fill in your values:

```bash
# AWS API Gateway
API_URL=https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/prod/ingest

# Device settings
DEVICE_ID=pi-001
LOCATION=attic

# Alerts (ntfy.sh)
NTFY_TOPIC=your-unique-topic-name

# Database (set in AWS Lambda console, not here)
# DATABASE_URL=postgresql://user:pass@host.neon.tech/neondb?sslmode=require
```

---

## 📈 Skills Demonstrated

- **Data Engineering** — end-to-end ETL pipeline design and implementation
- **Cloud Architecture** — serverless AWS services (Lambda, API Gateway, CloudWatch)
- **Database Design** — PostgreSQL schema design, views, indexes
- **Python** — sensor I/O, HTTP clients, data transformation, error handling
- **Infrastructure** — Linux cron scheduling, SSH, environment configuration
- **Visualization** — Grafana Cloud dashboards, time series analysis
- **DevOps** — AWS CLI deployment, Git version control
- **IoT** — Raspberry Pi hardware integration, I2C sensors
- **Monitoring** — real-time alerting, logging, CloudWatch

---

## 🔮 Planned Improvements

- [ ] Home Assistant integration
- [ ] Multiple Pi device support
- [ ] Historical weather API comparison

---

## 📄 License

MIT License — feel free to use this project as a template for your own sensor pipeline.

---

## 👤 Author

**Cameron** — [@MYDUSTYVISION](https://github.com/MYDUSTYVISION)
**Claude:Fabel** - Dabugging and notation
