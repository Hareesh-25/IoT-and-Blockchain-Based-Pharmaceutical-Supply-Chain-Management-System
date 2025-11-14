// frontend/src/App.jsx
// Updated App.jsx — adds an Alerts popup/modal that opens when you click "Trace".
// Paste this over your existing frontend/src/App.jsx
import React, { useEffect, useState, useRef } from "react";

const BACKEND = "http://localhost:3000";
const WS_URL = "ws://localhost:3001";

const SENSORS = ["temperature", "humidity", "gps", "vibration", "light"];

function linePoints(data, accessor, w = 600, h = 160) {
  if (!data || data.length === 0) return "";
  const vals = data.map(accessor).filter((v) => typeof v === "number");
  if (vals.length === 0) return "";
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  return data
    .map((d, i) => {
      const x = (i / Math.max(1, data.length - 1)) * w;
      const v = accessor(d);
      const y = typeof v === "number" ? h - ((v - min) / (max - min || 1)) * h : h;
      return `${x},${y}`;
    })
    .join(" ");
}

function Modal({ title, onClose, children }) {
  return (
    <div style={{
      position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(10, 11, 13, 0.45)", zIndex: 9999
    }}>
      <div style={{ width: 720, maxHeight: "80vh", overflow: "auto", background: "#fff", borderRadius: 8, padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button onClick={onClose} style={{ background: "#ef4444", color: "white", border: "none", padding: "6px 10px", borderRadius: 6 }}>Close</button>
        </div>
        <div>{children}</div>
      </div>
    </div>
  );
}

export default function App() {
  const [role, setRole] = useState("Manufacturer");
  const [batchId, setBatchId] = useState("BATCH-1001");
  const [events, setEvents] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [sensor, setSensor] = useState("temperature");
  const [chartData, setChartData] = useState([]);
  const [requests, setRequests] = useState([]);
  const [verifyResult, setVerifyResult] = useState(null);
  const [showAlertsModal, setShowAlertsModal] = useState(false);
  const [modalAlerts, setModalAlerts] = useState([]);
  const wsRef = useRef(null);

  useEffect(() => {
    fetch(`${BACKEND}/alerts`).then((r) => r.json()).then(setAlerts);
    fetch(`${BACKEND}/blocks`).then((r) => r.json()).then(setBlocks);
    fetch(`${BACKEND}/requests`).then((r) => r.json()).then(setRequests);
    traceBatch(batchId);

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    ws.onmessage = (msg) => {
      const payload = JSON.parse(msg.data);
      if (payload.type === "iot") {
        const d = payload.data;
        if (d.batchId === batchId) {
          setEvents((e) => [...e, d]);
          setChartData((c) => [...c.slice(-80), d]);
        }
      } else if (payload.type === "alert") {
        setAlerts((a) => [...a, payload.data]);
      } else if (payload.type === "block") {
        setBlocks((b) => [...b, payload.data]);
      } else if (payload.type === "fda_request") {
        setRequests((r) => [...r, payload.data]);
      } else if (payload.type === "fda_approve") {
        fetch(`${BACKEND}/requests`).then((r) => r.json()).then(setRequests);
      } else if (payload.type === "transfer" || payload.type === "fda_approve" || payload.type === "fda_request") {
        if (payload.data.batchId === batchId) {
          setEvents((e) => [...e, payload.data]);
        }
      }
    };
    ws.onerror = console.error;
    return () => ws.close();
  }, [batchId]);

  async function traceBatch(id) {
    const res = await fetch(`${BACKEND}/batch/${id}`);
    const data = await res.json();
    setEvents(data || []);
    setChartData((data || []).filter((d) => !!d));
    // also prepare alerts modal content for this batch
    const batchAlerts = alerts.filter((a) => a.batchId === id).slice().reverse();
    setModalAlerts(batchAlerts);
  }

  const post = (url, body) =>
    fetch(`${BACKEND}${url}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => r.json());

  async function refreshRequests() {
    const r = await fetch(`${BACKEND}/requests`).then((r) => r.json());
    setRequests(r || []);
  }

  async function approveRequest(batchIdToApprove) {
    const res = await post("/fda/approve", { batchId: batchIdToApprove, approver: "FDA" });
    await refreshRequests();
    return res;
  }

  async function runVerify() {
    const v = await fetch(`${BACKEND}/verify`).then((r) => r.json());
    setVerifyResult(v);
  }

  async function fixBusinessIssue(issue) {
    if (!issue || !issue.batchId) return;
    const ok = window.confirm(`Insert retroactive FDA approval for ${issue.batchId}? This will modify history in db.json (backup first). Proceed?`);
    if (!ok) return;

    try {
      const res = await fetch(`${BACKEND}/repair/insert_approval`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId: issue.batchId, approver: "RetroFitAdmin" }),
      }).then((r) => r.json());

      if (res && res.success) {
        await runVerify();
        const newBlocks = await fetch(`${BACKEND}/blocks`).then((r) => r.json());
        setBlocks(newBlocks || []);
        await refreshRequests();
        await traceBatch(batchId);
        alert(`Inserted approval for ${issue.batchId} at index ${res.insertedIndex}. Verify re-run.`);
      } else {
        alert("Repair failed: " + (res.message || JSON.stringify(res)));
      }
    } catch (err) {
      console.error("Fix failed", err);
      alert("Fix failed: " + err.message);
    }
  }

  // NEW: when clicking Trace, show alerts popup as well as fetch batch events
  const handleTraceClick = async () => {
    await traceBatch(batchId);
    // refresh alerts from server for consistency, then show modal
    const latestAlerts = await fetch(`${BACKEND}/alerts`).then((r) => r.json());
    const batchAlerts = latestAlerts.filter((a) => a.batchId === batchId).slice().reverse();
    setModalAlerts(batchAlerts);
    setShowAlertsModal(true);
  };

  // filter logs for selected sensor
  const sensorLogs = events
    .filter((ev) => {
      if (sensor === "gps") return ev.gps;
      return ev[sensor] !== undefined;
    })
    .slice(-80)
    .reverse();

  // numeric series for chart
  const numericSeries = chartData.filter((d) => {
    if (sensor === "gps") return !!d.gps;
    return typeof d[sensor] === "number";
  });

  const acc = (d) => {
    if (!d) return 0;
    if (sensor === "gps") return d.gps ? d.gps.lat : 0;
    return d[sensor];
  };

  return (
    <div>
      <div className="header">
        <h2>💊 PharmaTrace — Multi-sensor Dashboard</h2>
        <div className="small">Live updates via WebSocket</div>
      </div>

      <div className="card controls">
        <div>
          <label>Role: </label>
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option>Manufacturer</option>
            <option>Distributor</option>
            <option>Pharmacy</option>
            <option>FDA</option>
          </select>
        </div>

        <div>
          <label style={{ marginLeft: 6 }}>Batch: </label>
          <input value={batchId} onChange={(e) => setBatchId(e.target.value)} />
        </div>

        {/* updated Trace button to open alerts modal */}
        <button onClick={() => handleTraceClick()}>Trace</button>

        {role === "Manufacturer" && (
          <>
            <button onClick={() => post("/supply/transfer", { batchId, from: "Factory", to: "Distributor" })}>Transfer</button>
            <button onClick={() => post("/fda/request", { batchId, requester: "Manufacturer" }).then(() => refreshRequests())}>Request FDA</button>
          </>
        )}

        {role === "FDA" && <button onClick={() => runVerify()}>Run Verify</button>}
      </div>

      <div className="card">
        <div className="legend">Sensors — click to view</div>
        <div className="sensor-row">
          {SENSORS.map((s) => (
            <button key={s} className="sensor" onClick={() => setSensor(s)} style={{ border: sensor === s ? "2px solid #0ea5e9" : undefined }}>
              {s.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="grid">
        <div>
          <div className="card">
            <h3>{sensor.toUpperCase()} — Live Chart</h3>
            <div className="chart">
              <svg width="100%" height="160" viewBox="0 0 600 160" preserveAspectRatio="none">
                <polyline
                  fill="none"
                  stroke="#0ea5e9"
                  strokeWidth="2"
                  points={linePoints(numericSeries, acc, 600, 140)}
                />
                {numericSeries.map((d, i) => {
                  const x = (i / Math.max(1, numericSeries.length - 1)) * 600;
                  const v = acc(d);
                  const vals = numericSeries.map((dd) => acc(dd));
                  const min = Math.min(...vals);
                  const max = Math.max(...vals);
                  const y = typeof v === "number" ? 140 - ((v - min) / (max - min || 1)) * 140 : 140;
                  return <circle key={i} cx={x} cy={y} r="3" fill="#024ea2" />;
                })}
              </svg>
            </div>
            <div className="small">Showing last {numericSeries.length} points for {batchId}</div>
          </div>

          <div className="card">
            <h3>Sensor Logs ({sensor.toUpperCase()})</h3>
            <div className="logs">
              {sensorLogs.length === 0 && <div className="small">No logs for this sensor yet.</div>}
              <ul>
                {sensorLogs.map((l, idx) => (
                  <li key={idx} style={{ marginBottom: 6 }}>
                    <div style={{ fontSize: 12, color: "#475569" }}>{l.timestamp}</div>
                    <div>
                      {sensor === "gps" ? (
                        <strong>GPS: {l.gps?.lat}, {l.gps?.lon}</strong>
                      ) : (
                        <strong>{sensor}: {String(l[sensor])}</strong>
                      )} — <span className="small">loc: {l.location}</span>
                      {l.tamper && <span className="alert"> — TAMPER</span>}
                      {l.note && <div className="small">{l.note}</div>}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div>
          <div className="card">
            <h3>Requests</h3>
            <div className="small">Pending FDA requests (per-batch)</div>
            <div className="logs">
              {requests.length === 0 && <div className="small">No pending requests</div>}
              <ul>
                {requests.map((r, i) => (
                  <li key={i} style={{ marginBottom: 8 }}>
                    <div style={{ fontWeight: 700 }}>{r.batchId}</div>
                    <div className="small">requested at: {r.timestamp} by {r.requester}</div>
                    {role === "FDA" && <button style={{ marginTop: 6 }} onClick={() => approveRequest(r.batchId).then(() => refreshRequests())}>Approve</button>}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="card">
            <h3>Verify Chain</h3>
            <div className="small">Cryptographic + business rule verification</div>
            <div style={{ marginTop: 8 }}>
              <button onClick={() => runVerify()}>Run Verify</button>
            </div>

            {verifyResult && (
              <div style={{ marginTop: 12 }}>
                <div><strong>Overall valid:</strong> {String(verifyResult.valid)}</div>
                <div><strong>Crypto valid:</strong> {String(verifyResult.cryptoValid)}</div>
                <div><strong>Business valid:</strong> {String(verifyResult.businessValid)}</div>

                {verifyResult.cryptoIssues && verifyResult.cryptoIssues.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontWeight: 700 }}>Crypto issues</div>
                    <ul>
                      {verifyResult.cryptoIssues.map((ci, idx) => <li key={idx}>{ci.index}: {ci.reason}</li>)}
                    </ul>
                  </div>
                )}

                {verifyResult.businessIssues && verifyResult.businessIssues.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontWeight: 700 }}>Business issues (transfers without approval)</div>
                    <ul>
                      {verifyResult.businessIssues.map((bi, idx) => (
                        <li key={idx} style={{ marginBottom: 10 }}>
                          <div><strong>#{bi.index} batch {bi.batchId}:</strong> {bi.reason}</div>
                          <div className="small">tx: {JSON.stringify(bi.tx).slice(0, 160)}...</div>
                          <div style={{ marginTop: 6 }}>
                            <button onClick={() => fixBusinessIssue(bi)} className="secondary">Fix (insert approval)</button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="card">
            <h3>Ledger (recent)</h3>
            <div className="block-list">
              {blocks.slice(-8).reverse().map((b) => (
                <div key={b.index} style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>#{b.index} {new Date(b.timestamp).toLocaleTimeString()}</div>
                  <div className="small">{b.data.type} — {JSON.stringify(b.data).slice(0, 100)}...</div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <h3>Alerts</h3>
            <div className="logs">
              {alerts.slice().reverse().map((a, i) => (
                <li key={i} style={{ marginBottom: 8 }}>
                  <div className="alert">{a.batchId} — {a.sensor}: {a.message}</div>
                  <div className="small">{a.time}</div>
                </li>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Alerts modal shown when Trace clicked */}
      {showAlertsModal && (
        <Modal title={`Alerts for ${batchId}`} onClose={() => setShowAlertsModal(false)}>
          <div style={{ marginBottom: 8 }}>
            <strong>{modalAlerts.length}</strong> alert(s) for <strong>{batchId}</strong>
          </div>
          <div style={{ maxHeight: "60vh", overflow: "auto" }}>
            {modalAlerts.length === 0 && <div className="small">No alerts for this batch.</div>}
            <ul>
              {modalAlerts.map((a, i) => (
                <li key={i} style={{ marginBottom: 10 }}>
                  <div style={{ fontWeight: 700 }}>{a.sensor.toUpperCase()} — {a.message}</div>
                  <div className="small">{a.time} — reading: {a.reading ? JSON.stringify(a.reading).slice(0, 160) + "..." : "N/A"}</div>
                </li>
              ))}
            </ul>
          </div>
        </Modal>
      )}
    </div>
  );
}
