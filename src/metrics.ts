import client from "prom-client";
import config from "./config";

export const registry = new client.Registry();
registry.setDefaultLabels({ service: "orchestrator_emulator", version: config.version });
client.collectDefaultMetrics({ register: registry });

export const turnCounter = new client.Counter({
  name: "emu_turns_total",
  help: "Total turns accepted by the emulator",
  labelNames: ["fixture_id"],
  registers: [registry],
});

export const missCounter = new client.Counter({
  name: "emu_miss_total",
  help: "Simulated misses by kind",
  labelNames: ["kind"],
  registers: [registry],
});

export const sseGauge = new client.Gauge({
  name: "emu_sse_clients",
  help: "Current SSE client connections",
  registers: [registry],
});

export const latencyHistogram = new client.Histogram({
  name: "emu_latency_ms",
  help: "Observed delay per phase in milliseconds",
  labelNames: ["phase"],
  buckets: [200, 400, 600, 800, 1000, 1500, 2000, 2500, 3000, 4000, 6000],
  registers: [registry],
});

export const shareCounter = new client.Counter({
  name: "emu_share_links_total",
  help: "Issued and expired share links",
  labelNames: ["status"],
  registers: [registry],
});

export async function getMetrics(): Promise<string> {
  return registry.metrics();
}

