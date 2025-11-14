// backend/simulator.js
// Simulator for multiple sensors: temperature, humidity, gps, vibration, light.
// Posts to 127.0.0.1 to avoid IPv6 ::1 issues. Handles network errors gracefully.

const batches = ["BATCH-1001", "BATCH-1002", "BATCH-1003"];
const BACKEND = "http://127.0.0.1:3000"; // force IPv4

function randomBetween(min, max) {
  return Math.random() * (max - min) + min;
}
function rndInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function sendReading(reading) {
  try {
    const res = await fetch(`${BACKEND}/iot/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reading),
    });
    if (!res.ok) {
      console.warn("Simulator: server responded", res.status);
    }
  } catch (err) {
    console.error("Simulator: failed to send reading:", err.message);
  }
}

function generateGPS(baseLat, baseLon, jitter = 0.05) {
  // small jitter around base coords
  return { lat: Math.round((baseLat + (Math.random() - 0.5) * jitter) * 1e6) / 1e6, lon: Math.round((baseLon + (Math.random() - 0.5) * jitter) * 1e6) / 1e6 };
}

// Base GPS per batch (different locations)
const baseGps = {
  "BATCH-1001": { lat: 19.0760, lon: 72.8777 }, // Mumbai-ish
  "BATCH-1002": { lat: 28.7041, lon: 77.1025 }, // Delhi-ish
  "BATCH-1003": { lat: 13.0827, lon: 80.2707 }, // Chennai-ish
};

async function simulateOnce() {
  for (const batch of batches) {
    // decide anomaly/tamper
    const tamper = Math.random() < 0.06; // 6% tamper
    const anomalyTemp = Math.random() < 0.08; // 8% temp anomaly
    const anomalyVib = Math.random() < 0.05; // 5% vibration spike
    const anomalyGps = Math.random() < 0.03; // 3% gps outlier

    // Temperature normal 18-28, anomaly either very hot or very cold
    let temperature = anomalyTemp ? (Math.random() > 0.5 ? randomBetween(31, 40) : randomBetween(-2, 1.5)) : randomBetween(18, 28);
    let humidity = randomBetween(35, 60);
    let vibration = anomalyVib ? randomBetween(2.5, 5.0) : randomBetween(0.0, 1.2); // g
    let light = Math.round(Math.random() < 0.02 ? randomBetween(0, 0.5) : randomBetween(50, 800)); // lux

    // GPS: either normal jitter around base or big outlier
    let gps = generateGPS(baseGps[batch].lat, baseGps[batch].lon, 0.02);
    if (anomalyGps) {
      gps = { lat: Math.round((baseGps[batch].lat + (Math.random() > 0.5 ? 5 : -5)) * 1e6) / 1e6, lon: Math.round((baseGps[batch].lon + (Math.random() > 0.5 ? 5 : -5)) * 1e6) / 1e6 };
    }

    // assemble reading
    const reading = {
      batchId: batch,
      temperature: Math.round(temperature * 100) / 100,
      humidity: Math.round(humidity * 100) / 100,
      vibration: Math.round(vibration * 100) / 100,
      light,
      gps,
      location: tamper ? "UNKNOWN_TAMPER_LOCATION" : ["Factory", "Warehouse", "Shipping", "Pharmacy"][rndInt(0, 3)],
      tamper,
      note: tamper ? "simulated tamper/transfer event" : undefined,
      timestamp: new Date().toISOString(),
    };

    await sendReading(reading);
    await sleep(80 + Math.floor(Math.random() * 220)); // slight stagger
  }
}

console.log("🌡️ Multi-sensor IoT Simulator starting (posts to http://127.0.0.1:3000)");

// run randomized interval 2-5s
(async function loop() {
  while (true) {
    await simulateOnce();
    const delay = 2000 + Math.floor(Math.random() * 3000);
    await sleep(delay);
  }
})().catch((err) => {
  console.error("Simulator loop error:", err);
  process.exit(1);
});
