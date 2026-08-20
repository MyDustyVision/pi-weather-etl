import { useState, useEffect, useCallback } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine
} from "recharts";

// ── Design tokens ────────────────────────────────────────────
const C = {
  bg:       "#070C18",
  surface:  "#0E1525",
  card:     "#131D30",
  border:   "#1E2D45",
  amber:    "#F59E0B",
  amberDim: "#78490A",
  cyan:     "#06B6D4",
  cyanDim:  "#065466",
  white:    "#F0F4FF",
  muted:    "#4A6080",
  green:    "#34D399",
  greenDim: "#065433",
  danger:   "#EF4444",
  ok:       "#22C55E",
};

const mono = "'JetBrains Mono', 'Fira Code', 'Courier New', monospace";
const sans = "system-ui, -apple-system, sans-serif";

// ── Helpers ───────────────────────────────────────────────────
function fmtTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}
function fmtDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString([], {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
}
function ago(iso) {
  if (!iso) return "";
  const diff = Math.round((Date.now() - new Date(iso)) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  return `${Math.round(diff / 3600)}h ago`;
}

function getRainPrediction(readings) {
  if (!readings || readings.length < 2) return null;

  const now = readings[readings.length - 1];
  const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);

  // Find reading closest to 3 hours ago
  const old = readings.reduce((best, r) => {
    const t = new Date(r.recorded_at);
    if (t > threeHoursAgo) return best;
    return !best || t > new Date(best.recorded_at) ? r : best;
  }, null);

  if (!old) return null;

  const pressureDelta = parseFloat(now.pressure_hpa) - parseFloat(old.pressure_hpa);
  const humidityNow   = parseFloat(now.humidity_pct);
  const humidityOld   = parseFloat(old.humidity_pct);
  const humidityDelta = humidityNow - humidityOld;
  const dewPointGap   = now.dew_point_c != null
    ? parseFloat(now.temp_c) - parseFloat(now.dew_point_c)
    : null;

  // Score system: negative = bad (rain), positive = good (fair)
  let score = 0;
  if (pressureDelta < -3)   score -= 3;  // Rapid pressure drop
  else if (pressureDelta < -1.5) score -= 2;  // Moderate drop
  else if (pressureDelta < -0.5) score -= 1;  // Slow drop
  else if (pressureDelta > 1)    score += 2;  // Rising pressure

  if (humidityDelta > 10)   score -= 2;  // Humidity rising fast
  else if (humidityDelta > 5) score -= 1;
  if (humidityNow > 85)     score -= 1;  // Already very humid

  if (dewPointGap !== null && dewPointGap < 3) score -= 1; // Near dew point

  // Determine level
  let level, emoji, label, detail, color, glow;
  if (score <= -4) {
    level = "high"; emoji = "🌧️"; label = "Rain Likely";
    color = "#EF4444"; glow = "#EF444440";
    detail = `Pressure ${pressureDelta.toFixed(1)} hPa over 3h · Humidity ${humidityNow.toFixed(0)}%`;
  } else if (score <= -2) {
    level = "medium"; emoji = "⛅"; label = "Watch";
    color = "#F59E0B"; glow = "#F59E0B40";
    detail = `Pressure ${pressureDelta.toFixed(1)} hPa over 3h · Humidity ${humidityNow.toFixed(0)}%`;
  } else if (score <= 0) {
    level = "low"; emoji = "🌤️"; label = "Possible Change";
    color = "#06B6D4"; glow = "#06B6D440";
    detail = `Pressure ${pressureDelta > 0 ? "+" : ""}${pressureDelta.toFixed(1)} hPa over 3h`;
  } else {
    level = "none"; emoji = "☀️"; label = "Fair Weather";
    color = "#34D399"; glow = "#34D39940";
    detail = `Pressure +${pressureDelta.toFixed(1)} hPa over 3h · Stable`;
  }

  return { level, emoji, label, detail, color, glow, pressureDelta, humidityNow, score };
}

// ── Sub-components ────────────────────────────────────────────

function GlowReadout({ label, value, unit, color, sub }) {
  return (
    <div style={{
      background: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: 12,
      padding: "28px 32px",
      position: "relative",
      overflow: "hidden",
      flex: 1,
      minWidth: 200,
    }}>
      {/* Glow blob */}
      <div style={{
        position: "absolute", top: -40, right: -40,
        width: 140, height: 140,
        borderRadius: "50%",
        background: color,
        opacity: 0.08,
        filter: "blur(30px)",
        pointerEvents: "none",
      }} />
      <div style={{ fontFamily: sans, fontSize: 11, letterSpacing: "0.12em",
        textTransform: "uppercase", color: C.muted, marginBottom: 12 }}>
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{
          fontFamily: mono, fontSize: 52, fontWeight: 700,
          color: value != null ? color : C.muted,
          lineHeight: 1,
          textShadow: value != null ? `0 0 24px ${color}55` : "none",
        }}>
          {value != null ? value : "—"}
        </span>
        <span style={{ fontFamily: mono, fontSize: 18, color: C.muted }}>{unit}</span>
      </div>
      {sub && (
        <div style={{ fontFamily: mono, fontSize: 12, color: C.muted, marginTop: 8 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function StatPill({ label, value }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontFamily: mono, fontSize: 14, color: C.white }}>{value ?? "—"}</div>
      <div style={{ fontFamily: sans, fontSize: 10, color: C.muted,
        textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 2 }}>{label}</div>
    </div>
  );
}

function RainPredictor({ readings }) {
  const prediction = getRainPrediction(readings);

  if (!prediction) return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderRadius: 12, padding: "20px 24px", marginBottom: 24,
      fontFamily: mono, fontSize: 12, color: C.muted,
    }}>
      ⏳ Gathering pressure history — rain prediction available after 3+ hours of data
    </div>
  );

  const { emoji, label, detail, color, glow, pressureDelta, humidityNow } = prediction;

  return (
    <div style={{
      background: C.card, border: `1px solid ${color}40`,
      borderRadius: 12, padding: "20px 24px", marginBottom: 24,
      position: "relative", overflow: "hidden",
      boxShadow: `0 0 20px ${glow}`,
    }}>
      {/* Glow blob */}
      <div style={{
        position: "absolute", top: -30, right: -30,
        width: 120, height: 120, borderRadius: "50%",
        background: color, opacity: 0.06, filter: "blur(30px)",
        pointerEvents: "none",
      }} />

      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        {/* Icon + label */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 32 }}>{emoji}</span>
          <div>
            <div style={{ fontFamily: sans, fontSize: 10, letterSpacing: "0.12em",
              textTransform: "uppercase", color: C.muted, marginBottom: 4 }}>
              Rain Prediction
            </div>
            <div style={{ fontFamily: mono, fontSize: 18, fontWeight: 700, color }}>
              {label}
            </div>
          </div>
        </div>

        <div style={{ width: 1, height: 40, background: C.border }} />

        {/* Detail stats */}
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontFamily: sans, fontSize: 10, color: C.muted,
              textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
              3hr Pressure Δ
            </div>
            <div style={{ fontFamily: mono, fontSize: 16, color: pressureDelta < 0 ? C.danger : C.ok }}>
              {pressureDelta > 0 ? "+" : ""}{pressureDelta.toFixed(2)} hPa
            </div>
          </div>
          <div>
            <div style={{ fontFamily: sans, fontSize: 10, color: C.muted,
              textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
              Humidity
            </div>
            <div style={{ fontFamily: mono, fontSize: 16, color: C.green }}>
              {humidityNow.toFixed(1)}%
            </div>
          </div>
        </div>

        <div style={{ flex: 1 }} />

        {/* Detail text */}
        <div style={{ fontFamily: mono, fontSize: 11, color: C.muted, textAlign: "right" }}>
          {detail}
        </div>
      </div>
    </div>
  );
}

function SensorChart({ data, dataKey, color, unit, label, domain }) {
  const CustomTooltip = ({ active, payload, label: lbl }) => {
    if (!active || !payload?.length) return null;
    return (
      <div style={{
        background: C.surface, border: `1px solid ${C.border}`,
        borderRadius: 8, padding: "10px 14px",
        fontFamily: mono, fontSize: 12,
      }}>
        <div style={{ color: C.muted, marginBottom: 4 }}>{fmtDateTime(lbl)}</div>
        <div style={{ color }}>
          {payload[0].value} {unit}
        </div>
      </div>
    );
  };

  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderRadius: 12, padding: "24px 24px 16px",
      flex: 1, minWidth: 0,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: color,
          boxShadow: `0 0 8px ${color}` }} />
        <span style={{ fontFamily: sans, fontSize: 11, letterSpacing: "0.12em",
          textTransform: "uppercase", color: C.muted }}>{label}</span>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="2 6" stroke={C.border} vertical={false} />
          <XAxis
            dataKey="recorded_at"
            tickFormatter={fmtTime}
            tick={{ fill: C.muted, fontSize: 10, fontFamily: mono }}
            axisLine={false} tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={domain || ["auto", "auto"]}
            tick={{ fill: C.muted, fontSize: 10, fontFamily: mono }}
            axisLine={false} tickLine={false}
            tickFormatter={v => `${v}${unit}`}
          />
          <Tooltip content={<CustomTooltip />} />
          <Line
            type="monotone"
            dataKey={dataKey}
            stroke={color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: color, strokeWidth: 0 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function DataTable({ readings }) {
  const rows = [...readings].reverse().slice(0, 50);
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: mono, fontSize: 12 }}>
        <thead>
          <tr>
            {["Timestamp", "Temp °C", "Temp °F", "Pressure hPa", "Pressure inHg", "Humidity %", "Dew Point °C", "Device", "Location"].map(h => (
              <th key={h} style={{
                textAlign: "left", padding: "10px 16px",
                color: C.muted, fontWeight: 400,
                fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase",
                borderBottom: `1px solid ${C.border}`,
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} style={{ background: i % 2 === 0 ? "transparent" : `${C.surface}88` }}>
              <td style={{ padding: "10px 16px", color: C.muted }}>{fmtDateTime(r.recorded_at)}</td>
              <td style={{ padding: "10px 16px", color: C.amber }}>{r.temp_c}</td>
              <td style={{ padding: "10px 16px", color: C.amber }}>{r.temp_f}</td>
              <td style={{ padding: "10px 16px", color: C.cyan }}>{r.pressure_hpa}</td>
              <td style={{ padding: "10px 16px", color: C.cyan }}>{r.pressure_inhg}</td>
              <td style={{ padding: "10px 16px", color: C.green }}>{r.humidity_pct}</td>
              <td style={{ padding: "10px 16px", color: C.green }}>{r.dew_point_c ?? "—"}</td>
              <td style={{ padding: "10px 16px", color: C.white }}>{r.device_id || "—"}</td>
              <td style={{ padding: "10px 16px", color: C.muted }}>{r.location || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && (
        <div style={{ padding: 40, textAlign: "center", color: C.muted, fontFamily: sans }}>
          No readings found for this time window.
        </div>
      )}
    </div>
  );
}

// ── Config screen ─────────────────────────────────────────────
function ConfigScreen({ onSave }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");

  const handleSave = () => {
    const trimmed = url.trim().replace(/\/$/, "");
    if (!trimmed.startsWith("https://")) {
      setError("URL must start with https://");
      return;
    }
    onSave(trimmed);
  };

  return (
    <div style={{
      minHeight: "100vh", background: C.bg,
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 24,
    }}>
      <div style={{
        background: C.card, border: `1px solid ${C.border}`,
        borderRadius: 16, padding: "48px 40px",
        maxWidth: 520, width: "100%",
      }}>
        {/* Icon */}
        <div style={{ fontSize: 40, marginBottom: 24, textAlign: "center" }}>🥧</div>
        <h1 style={{
          fontFamily: mono, fontSize: 20, color: C.white,
          margin: "0 0 8px", textAlign: "center",
        }}>Sensor Station</h1>
        <p style={{
          fontFamily: sans, fontSize: 14, color: C.muted,
          textAlign: "center", margin: "0 0 36px",
        }}>
          Enter your AWS API Gateway base URL to connect to your Pi's data.
        </p>

        <label style={{ fontFamily: sans, fontSize: 11, color: C.muted,
          letterSpacing: "0.1em", textTransform: "uppercase", display: "block", marginBottom: 8 }}>
          API Gateway Base URL
        </label>
        <input
          value={url}
          onChange={e => { setUrl(e.target.value); setError(""); }}
          onKeyDown={e => e.key === "Enter" && handleSave()}
          placeholder="https://abc123.execute-api.us-east-1.amazonaws.com/prod"
          style={{
            width: "100%", boxSizing: "border-box",
            background: C.surface, border: `1px solid ${error ? C.danger : C.border}`,
            borderRadius: 8, padding: "12px 16px",
            fontFamily: mono, fontSize: 12, color: C.white,
            outline: "none",
          }}
        />
        {error && (
          <div style={{ color: C.danger, fontFamily: sans, fontSize: 12, marginTop: 8 }}>
            {error}
          </div>
        )}
        <p style={{ fontFamily: mono, fontSize: 11, color: C.muted, margin: "10px 0 0" }}>
          e.g. https://abc123.execute-api.us-east-1.amazonaws.com/prod
        </p>

        <button
          onClick={handleSave}
          style={{
            marginTop: 28, width: "100%",
            background: C.cyan, border: "none", borderRadius: 8,
            padding: "14px", fontFamily: sans, fontSize: 14, fontWeight: 600,
            color: C.bg, cursor: "pointer",
          }}
        >
          Connect →
        </button>
      </div>
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────
function Dashboard({ apiBase, onDisconnect }) {
  const [readings, setReadings] = useState([]);
  const [stats, setStats]       = useState(null);
  const [hours, setHours]       = useState(24);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [lastFetch, setLastFetch] = useState(null);
  const [activeTab, setActiveTab] = useState("charts");

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const [rRes, sRes] = await Promise.all([
        fetch(`${apiBase}/readings?hours=${hours}&limit=500`),
        fetch(`${apiBase}/stats?days=7`),
      ]);

      if (!rRes.ok) throw new Error(`Readings API: ${rRes.status}`);
      if (!sRes.ok) throw new Error(`Stats API: ${sRes.status}`);

      const rData = await rRes.json();
      const sData = await sRes.json();

      setReadings(rData.readings || []);
      setStats(sData);
      setLastFetch(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [apiBase, hours]);

  useEffect(() => {
    setLoading(true);
    fetchData();
  }, [fetchData]);

  // Auto-refresh every 5 minutes
  useEffect(() => {
    const t = setInterval(fetchData, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [fetchData]);

  const latest   = stats?.latest;
  const summary  = stats?.summary;
  const tempPad  = readings.length ? [
    Math.min(...readings.map(r => r.temp_c)) - 1,
    Math.max(...readings.map(r => r.temp_c)) + 1,
  ] : ["auto", "auto"];
  const pressPad = readings.length ? [
    Math.min(...readings.map(r => r.pressure_hpa)) - 1,
    Math.max(...readings.map(r => r.pressure_hpa)) + 1,
  ] : ["auto", "auto"];

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.white, fontFamily: sans }}>

      {/* Header */}
      <div style={{
        borderBottom: `1px solid ${C.border}`,
        padding: "0 24px",
        display: "flex", alignItems: "center", gap: 16, height: 56,
      }}>
        <span style={{ fontFamily: mono, fontSize: 14, color: C.white, fontWeight: 700 }}>
          🥧 SENSOR STATION
        </span>
        <div style={{ flex: 1 }} />

        {/* Status dot */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{
            width: 7, height: 7, borderRadius: "50%",
            background: error ? C.danger : C.ok,
            boxShadow: `0 0 6px ${error ? C.danger : C.ok}`,
          }} />
          <span style={{ fontFamily: mono, fontSize: 11, color: C.muted }}>
            {error ? "OFFLINE" : lastFetch ? `LIVE · ${ago(lastFetch)}` : "CONNECTING"}
          </span>
        </div>

        <button
          onClick={fetchData}
          style={{
            background: "transparent", border: `1px solid ${C.border}`,
            borderRadius: 6, padding: "6px 14px",
            fontFamily: mono, fontSize: 11, color: C.muted, cursor: "pointer",
          }}
        >
          Refresh
        </button>
        <button
          onClick={onDisconnect}
          style={{
            background: "transparent", border: "none",
            fontFamily: mono, fontSize: 11, color: C.muted, cursor: "pointer",
          }}
        >
          Disconnect
        </button>
      </div>

      <div style={{ padding: "28px 24px", maxWidth: 1200, margin: "0 auto" }}>

        {/* Error banner */}
        {error && (
          <div style={{
            background: `${C.danger}15`, border: `1px solid ${C.danger}40`,
            borderRadius: 10, padding: "14px 20px", marginBottom: 24,
            fontFamily: mono, fontSize: 13, color: C.danger,
          }}>
            ⚠ {error} — check your API URL and Lambda logs.
          </div>
        )}

        {loading && !stats ? (
          <div style={{ textAlign: "center", padding: 80, color: C.muted, fontFamily: mono }}>
            Fetching sensor data…
          </div>
        ) : (
          <>
            {/* Live readouts */}
            <div style={{ display: "flex", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
              <GlowReadout
                label="Temperature °C"
                value={latest?.temp_c}
                unit="°C"
                color={C.amber}
                sub={latest ? `${ago(latest.recorded_at)}` : null}
              />
              <GlowReadout
                label="Temperature °F"
                value={latest?.temp_f}
                unit="°F"
                color={C.amber}
                sub={latest ? `${ago(latest.recorded_at)}` : null}
              />
              <GlowReadout
                label="Pressure"
                value={latest?.pressure_hpa}
                unit="hPa"
                color={C.cyan}
                sub={latest ? `${latest.pressure_inhg} inHg · ${latest.location || latest.device_id || ""}` : null}
              />
              <GlowReadout
                label="Humidity"
                value={latest?.humidity_pct}
                unit="%"
                color={C.green}
                sub={latest?.dew_point_c != null ? `Dew point ${latest.dew_point_c}°C` : null}
              />

              {/* 7-day summary card */}
              {summary && (
                <div style={{
                  background: C.card, border: `1px solid ${C.border}`,
                  borderRadius: 12, padding: "28px 32px", flex: 1, minWidth: 220,
                }}>
                  <div style={{ fontFamily: sans, fontSize: 11, letterSpacing: "0.12em",
                    textTransform: "uppercase", color: C.muted, marginBottom: 20 }}>
                    7-Day Summary
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
                    <StatPill label="Avg °C"  value={summary.avg_temp_c} />
                    <StatPill label="Min °C"  value={summary.min_temp_c} />
                    <StatPill label="Max °C"  value={summary.max_temp_c} />
                    <StatPill label="Avg hPa" value={summary.avg_pressure_hpa} />
                    <StatPill label="Min hPa" value={summary.min_pressure_hpa} />
                    <StatPill label="Max hPa" value={summary.max_pressure_hpa} />
                    <StatPill label="Avg RH%" value={summary.avg_humidity_pct} />
                    <StatPill label="Min RH%" value={summary.min_humidity_pct} />
                    <StatPill label="Max RH%" value={summary.max_humidity_pct} />
                  </div>
                  <div style={{ marginTop: 20, paddingTop: 16, borderTop: `1px solid ${C.border}`,
                    fontFamily: mono, fontSize: 11, color: C.muted }}>
                    {summary.total_readings?.toLocaleString()} readings recorded
                  </div>
                </div>
              )}
            </div>

            {/* Rain Prediction */}
            <RainPredictor readings={readings} />

            {/* Time range picker + tabs */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
              <div style={{ display: "flex", gap: 4 }}>
                {[6, 24, 48, 168].map(h => (
                  <button
                    key={h}
                    onClick={() => setHours(h)}
                    style={{
                      background: hours === h ? C.cyan : "transparent",
                      border: `1px solid ${hours === h ? C.cyan : C.border}`,
                      borderRadius: 6, padding: "5px 12px",
                      fontFamily: mono, fontSize: 11,
                      color: hours === h ? C.bg : C.muted,
                      cursor: "pointer",
                    }}
                  >
                    {h < 24 ? `${h}h` : `${h / 24}d`}
                  </button>
                ))}
              </div>

              <div style={{ flex: 1 }} />

              <div style={{ display: "flex", gap: 4 }}>
                {["charts", "table"].map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    style={{
                      background: activeTab === tab ? C.surface : "transparent",
                      border: `1px solid ${activeTab === tab ? C.border : "transparent"}`,
                      borderRadius: 6, padding: "5px 14px",
                      fontFamily: mono, fontSize: 11, color: activeTab === tab ? C.white : C.muted,
                      cursor: "pointer", textTransform: "capitalize",
                    }}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </div>

            {/* Charts */}
            {activeTab === "charts" && (
              <>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
                  <SensorChart
                    data={readings}
                    dataKey="temp_c"
                    color={C.amber}
                    unit="°C"
                    label={`Temperature — last ${hours < 24 ? `${hours}h` : `${hours / 24}d`}`}
                    domain={tempPad}
                  />
                  <SensorChart
                    data={readings}
                    dataKey="pressure_hpa"
                    color={C.cyan}
                    unit=" hPa"
                    label={`Pressure — last ${hours < 24 ? `${hours}h` : `${hours / 24}d`}`}
                    domain={pressPad}
                  />
                </div>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                  <SensorChart
                    data={readings}
                    dataKey="humidity_pct"
                    color={C.green}
                    unit="%"
                    label={`Humidity — last ${hours < 24 ? `${hours}h` : `${hours / 24}d`}`}
                    domain={[0, 100]}
                  />
                  <SensorChart
                    data={readings}
                    dataKey="dew_point_c"
                    color={C.green}
                    unit="°C"
                    label={`Dew Point — last ${hours < 24 ? `${hours}h` : `${hours / 24}d`}`}
                    domain={["auto", "auto"]}
                  />
                </div>
              </>
            )}

            {/* Table */}
            {activeTab === "table" && (
              <div style={{
                background: C.card, border: `1px solid ${C.border}`,
                borderRadius: 12, overflow: "hidden",
              }}>
                <DataTable readings={readings} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── App root ──────────────────────────────────────────────────
export default function App() {
  const [apiBase, setApiBase] = useState(() => {
    try { return sessionStorage.getItem("sensor_api_base") || null; }
    catch { return null; }
  });

  const handleConnect = (url) => {
    try { sessionStorage.setItem("sensor_api_base", url); } catch {}
    setApiBase(url);
  };

  const handleDisconnect = () => {
    try { sessionStorage.removeItem("sensor_api_base"); } catch {}
    setApiBase(null);
  };

  return apiBase
    ? <Dashboard apiBase={apiBase} onDisconnect={handleDisconnect} />
    : <ConfigScreen onSave={handleConnect} />;
}
