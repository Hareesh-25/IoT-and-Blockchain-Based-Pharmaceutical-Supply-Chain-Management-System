// backend/index.js
// Complete backend with repair endpoints: /repair/insert_approval, /db/clear-batch, /repair/recompute
import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import { WebSocketServer } from "ws";
import fs from "fs-extra";
import crypto from "crypto-js";

const app = express();
const PORT = 3000;
app.use(cors());
app.use(bodyParser.json());

const DB_PATH = "./db.json";
await fs.ensureFile(DB_PATH);
let db = {};
try {
  db = await fs.readJson(DB_PATH);
} catch (e) {
  db = { blocks: [], events: [], alerts: [] };
  await fs.writeJson(DB_PATH, db, { spaces: 2 });
}

let blocks = db.blocks || [];
let events = db.events || [];
let alerts = db.alerts || [];
let txCount = 0;

// Track FDA requests per batch
const fdaRequests = {}; // { "BATCH-1001": { requested: true, timestamp, requester } }

let connectedClients = [];
const wss = new WebSocketServer({ port: 3001 });
wss.on("connection", (ws) => {
  connectedClients.push(ws);
  ws.on("close", () => {
    connectedClients = connectedClients.filter((c) => c !== ws);
  });
});

const broadcast = (data) => {
  connectedClients.forEach((ws) => {
    if (ws.readyState === 1) ws.send(JSON.stringify(data));
  });
};

function sha256(data) {
  return crypto.SHA256(JSON.stringify(data)).toString();
}

// NOTE: when mining we include timestamp (string) and a nonce to avoid collisions.
// Recomputes hash deterministically from block.data + block.prevHash + block.timestamp + block.nonce
function computeBlockHash(block) {
  // ensure nonce exists
  if (block.nonce === undefined) block.nonce = Date.now() + Math.floor(Math.random() * 10000);
  return sha256(JSON.stringify(block.data) + block.prevHash + block.timestamp + String(block.nonce));
}

function mineBlock(data) {
  const prev = blocks[blocks.length - 1];
  const prevHash = prev ? prev.hash : "0";
  const block = {
    index: blocks.length,
    timestamp: new Date().toISOString(),
    data,
    prevHash,
    nonce: Date.now() + Math.floor(Math.random() * 10000),
  };
  block.hash = computeBlockHash(block);
  blocks.push(block);
  txCount++;
  persist();
  broadcast({ type: "block", data: block });
  return block;
}

// persist to db.json
function persist() {
  fs.writeJson(DB_PATH, { blocks, events, alerts }, { spaces: 2 }).catch(console.error);
}

// recompute chain hashes & prevHashes starting from index 0 or given index
function recomputeChainFrom(startIndex = 0) {
  for (let i = startIndex; i < blocks.length; i++) {
    const prevHash = i === 0 ? "0" : blocks[i - 1].hash;
    blocks[i].prevHash = prevHash;
    // ensure timestamp & nonce exist
    if (!blocks[i].timestamp) blocks[i].timestamp = new Date().toISOString();
    if (blocks[i].nonce === undefined) blocks[i].nonce = Date.now() + Math.floor(Math.random() * 10000);
    blocks[i].hash = computeBlockHash(blocks[i]);
    blocks[i].index = i;
  }
  persist();
  broadcast({ type: "chain_recomputed", data: { startIndex } });
}

// Simple anomaly detector checks multiple sensors
function detectAnomalies(reading) {
  const found = [];
  const ts = new Date().toISOString();

  if (typeof reading.temperature === "number") {
    if (reading.temperature < 2 || reading.temperature > 30) {
      found.push({ sensor: "temperature", message: `Temp anomaly ${reading.temperature} °C` });
    }
  }

  if (typeof reading.humidity === "number") {
    if (reading.humidity < 10 || reading.humidity > 90) {
      found.push({ sensor: "humidity", message: `Humidity anomaly ${reading.humidity}%` });
    }
  }

  if (typeof reading.vibration === "number") {
    if (reading.vibration > 2.0) {
      found.push({ sensor: "vibration", message: `High vibration ${reading.vibration} g` });
    }
  }

  if (typeof reading.light === "number") {
    if (reading.light > 2000 || reading.light < 1) {
      found.push({ sensor: "light", message: `Light anomaly ${reading.light} lux` });
    }
  }

  if (reading.gps && reading.gps.lat && reading.gps.lon) {
    const lat = reading.gps.lat;
    const lon = reading.gps.lon;
    if (lat < 5 || lat > 40 || lon < 60 || lon > 100) {
      found.push({ sensor: "gps", message: `GPS out-of-range (${lat}, ${lon})` });
    }
  }

  found.forEach((f) => {
    const alert = {
      batchId: reading.batchId,
      sensor: f.sensor,
      message: f.message,
      time: ts,
      reading,
    };
    alerts.push(alert);
    broadcast({ type: "alert", data: alert });
  });

  if (found.length > 0) persist();
  return found;
}

// ------------------- API ROUTES -------------------

// Health
app.get("/health", (req, res) => res.json({ ok: true, txCount, blocks: blocks.length, alerts: alerts.length }));

// IoT data ingest
app.post("/iot/ingest", (req, res) => {
  const reading = req.body;
  reading.timestamp = new Date().toISOString();
  reading.type = reading.type || "reading";
  events.push(reading);

  detectAnomalies(reading);

  const blk = mineBlock({ type: "iot", ...reading });
  broadcast({ type: "iot", data: reading });

  res.json({ success: true, block: blk });
});

// Get batch events
app.get("/batch/:id", (req, res) => {
  const batchId = req.params.id;
  res.json(events.filter((e) => e.batchId === batchId));
});

// Get all alerts
app.get("/alerts", (req, res) => {
  res.json(alerts);
});

// Get pending FDA requests
app.get("/requests", (req, res) => {
  const list = Object.entries(fdaRequests)
    .filter(([_, v]) => v.requested)
    .map(([batchId, v]) => ({ batchId, ...v }));
  res.json(list);
});

// Blockchain ledger
app.get("/blocks", (req, res) => {
  res.json(blocks);
});

// Supply chain transfer
app.post("/supply/transfer", (req, res) => {
  const tx = { ...req.body, type: "transfer", timestamp: new Date().toISOString() };
  events.push(tx);
  const blk = mineBlock(tx);
  broadcast({ type: "transfer", data: tx });
  res.json({ success: true, tx, block: blk });
});

// FDA request (per-batch)
app.post("/fda/request", (req, res) => {
  const { batchId, requester } = req.body;
  if (!batchId) return res.status(400).json({ success: false, message: "batchId required" });
  fdaRequests[batchId] = { requested: true, timestamp: new Date().toISOString(), requester: requester || "unknown" };
  const tx = { type: "fda_request", batchId, requester: requester || "unknown", timestamp: new Date().toISOString() };
  events.push(tx);
  const blk = mineBlock(tx);
  broadcast({ type: "fda_request", data: tx });
  res.json({ success: true, message: "FDA approval requested.", request: fdaRequests[batchId], block: blk });
});

// FDA approval (per-batch)
app.post("/fda/approve", (req, res) => {
  const { batchId, approver } = req.body;
  if (!batchId) return res.status(400).json({ success: false, message: "batchId required" });
  if (!fdaRequests[batchId] || !fdaRequests[batchId].requested) {
    return res.status(400).json({ success: false, message: "No pending request for this batch." });
  }
  fdaRequests[batchId].requested = false;
  fdaRequests[batchId].approved = { approver: approver || "FDA", timestamp: new Date().toISOString() };
  const tx = { type: "fda_approve", batchId, approver: approver || "FDA", timestamp: new Date().toISOString() };
  events.push(tx);
  const blk = mineBlock(tx);
  broadcast({ type: "fda_approve", data: tx });
  res.json({ success: true, message: "FDA approval granted.", approved: fdaRequests[batchId].approved, block: blk });
});

// Verify chain: cryptographic + business rules
app.get("/verify", (req, res) => {
  // 1) cryptographic integrity
  let cryptoValid = true;
  const cryptoIssues = [];
  for (let i = 1; i < blocks.length; i++) {
    if (blocks[i].prevHash !== blocks[i - 1].hash) {
      cryptoValid = false;
      cryptoIssues.push({ index: i, reason: "prevHash mismatch" });
    }
    // Also recompute and compare hash
    const recomputed = computeBlockHash(blocks[i]);
    if (recomputed !== blocks[i].hash) {
      cryptoValid = false;
      cryptoIssues.push({ index: i, reason: "hash mismatch (recomputed differs)" });
    }
  }

  // 2) business rules: for each transfer, ensure there exists an earlier fda_approve for same batch
  let businessValid = true;
  const businessIssues = [];

  const seenApprovals = {};
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const d = b.data || {};
    const type = d.type;
    if (type === "fda_approve" && d.batchId) {
      seenApprovals[d.batchId] = true;
    }
    if (type === "transfer" && d.batchId) {
      if (!seenApprovals[d.batchId]) {
        businessValid = false;
        businessIssues.push({
          index: i,
          batchId: d.batchId,
          reason: "transfer before FDA approval",
          tx: d,
        });
      }
    }
  }

  const valid = cryptoValid && businessValid;

  res.json({
    valid,
    cryptoValid,
    cryptoIssues,
    businessValid,
    businessIssues,
  });
});

// performance note
app.get("/stats", (req, res) => {
  res.json({ txCount, blocks: blocks.length, alerts: alerts.length });
});

/*
  REPAIR / DB MAINTENANCE ENDPOINTS
  - POST /repair/insert_approval { batchId } : insert an fda_approve block before first transfer for batch
  - POST /db/clear-batch { batchId } : remove all events/alerts for batch and remove blocks for that batch then recompute
  - POST /repair/recompute : recompute prevHash/hash for entire chain
*/

// Insert a synthetic approval block before the first transfer block of a batch
app.post("/repair/insert_approval", (req, res) => {
  const { batchId, approver } = req.body;
  if (!batchId) return res.status(400).json({ success: false, message: "batchId required" });

  // find first transfer block index for this batch
  const firstTransferIdx = blocks.findIndex((b) => b.data && b.data.type === "transfer" && b.data.batchId === batchId);
  if (firstTransferIdx === -1) {
    return res.status(400).json({ success: false, message: "No transfer found for this batch in chain" });
  }

  const approvalTx = {
    type: "fda_approve",
    batchId,
    approver: approver || "SYSTEM_REPAIR",
    timestamp: new Date().toISOString(),
  };

  // create block to insert
  const prevHash = firstTransferIdx === 0 ? "0" : blocks[firstTransferIdx - 1].hash;
  const newBlock = {
    index: firstTransferIdx,
    timestamp: approvalTx.timestamp,
    data: approvalTx,
    prevHash,
    nonce: Date.now() + Math.floor(Math.random() * 10000),
  };
  newBlock.hash = computeBlockHash(newBlock);

  // insert block into blocks array
  blocks.splice(firstTransferIdx, 0, newBlock);

  // insert event before corresponding transfer event in events[] if possible
  const firstTransferEventIdx = events.findIndex((e) => e.type === "transfer" && e.batchId === batchId);
  if (firstTransferEventIdx !== -1) {
    events.splice(firstTransferEventIdx, 0, approvalTx);
  } else {
    // fallback: push to events
    events.push(approvalTx);
  }

  // recompute chain hashes & prevHash for subsequent blocks (start from inserted index + 1)
  recomputeChainFrom(firstTransferIdx + 1);

  persist();
  broadcast({ type: "repair_insert_approval", data: { batchId, insertedAt: firstTransferIdx } });

  res.json({ success: true, message: "Inserted approval block before first transfer", insertedIndex: firstTransferIdx });
});

// Clear a batch: remove events and alerts for batch and any blocks that directly reference the batch
app.post("/db/clear-batch", (req, res) => {
  const { batchId } = req.body;
  if (!batchId) return res.status(400).json({ success: false, message: "batchId required" });

  // remove events and alerts
  const oldEvents = events.length;
  events = events.filter((e) => e.batchId !== batchId);
  const removedEvents = oldEvents - events.length;

  const oldAlerts = alerts.length;
  alerts = alerts.filter((a) => a.batchId !== batchId);
  const removedAlerts = oldAlerts - alerts.length;

  // remove blocks whose block.data.batchId === batchId
  const oldBlocks = blocks.length;
  blocks = blocks.filter((b) => !b.data || b.data.batchId !== batchId);
  const removedBlocks = oldBlocks - blocks.length;

  // recompute entire chain to reindex and rebuild hashes
  recomputeChainFrom(0);

  persist();
  broadcast({ type: "db_clear_batch", data: { batchId, removedEvents, removedAlerts, removedBlocks } });

  res.json({ success: true, message: "Cleared batch data from events/alerts/blocks (and recomputed chain)", removedEvents, removedAlerts, removedBlocks });
});

// Recompute entire chain hashes (useful after manual edits)
app.post("/repair/recompute", (req, res) => {
  recomputeChainFrom(0);
  res.json({ success: true, message: "Chain recomputed" });
});

// -------------------------------------------------

app.listen(PORT, () => {
  console.log(`✅ Backend running on http://localhost:${PORT}`);
  console.log(`🔌 WebSocket on ws://localhost:3001`);
});
