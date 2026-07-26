import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import WebSocket from "ws";
import { z } from "zod";

const GROUP = "7d744dad66f08596d14d94a1369aa288";
const DEVICE_ID = "4";
const WS_URL = `wss://api.app.knightjenay.cn/websocket-kisstoy?group=${GROUP}`;
const PORT = process.env.PORT || 3000;

let ws = null;
let isOnline = false;
let heartbeatTimer = null;

function connectWS() {
  try { ws = new WebSocket(WS_URL); } catch (e) {
    setTimeout(connectWS, 5000); return;
  }
  ws.on("open", () => {
    console.log("WS connected");
    heartbeatTimer = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ event: "ping" }));
    }, 10000);
    checkOnline();
  });
  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.event === "online_status") isOnline = msg.data?.online_status === 1;
    } catch (e) {}
  });
  ws.on("close", () => {
    console.warn("WS closed");
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    isOnline = false;
    setTimeout(connectWS, 5000);
  });
  ws.on("error", (err) => console.error("WS error:", err.message));
}

function checkOnline() {
  if (ws?.readyState === WebSocket.OPEN)
    ws.send(JSON.stringify({ event: "online_status", data: { group: GROUP } }));
}

function sendControl(intensity) {
  if (ws?.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify({
    event: "control",
    data: { target: GROUP, device_id: DEVICE_ID, motors: { "1": intensity } }
  }));
  return true;
}

function createMcpServer() {
  const server = new McpServer({ name: "toy-control", version: "1.0.0" });

  server.tool("toy_vibrate",
    "Set vibration intensity (0-100). Min effective strength is 20.",
    { intensity: z.number().min(0).max(100).describe("Vibration intensity 0-100") },
    async ({ intensity }) => {
      let v = Math.round(intensity / 5) * 5;
      if (v > 0 && v < 20) v = 20;
      checkOnline();
      await new Promise(r => setTimeout(r, 500));
      if (!isOnline) return { content: [{ type: "text", text: "Device offline." }] };
      const ok = sendControl(v);
      if (!ok) return { content: [{ type: "text", text: "WebSocket disconnected." }] };
      return { content: [{ type: "text", text: v === 0 ? "Vibration stopped." : `Vibration set to ${v}%.` }] };
    }
  );

  server.tool("toy_stop", "Stop vibration immediately.", {},
    async () => {
      const ok = sendControl(0);
      return { content: [{ type: "text", text: ok ? "Stopped." : "WebSocket disconnected." }] };
    }
  );

  server.tool("toy_status", "Check if the toy is online.", {},
    async () => {
      checkOnline();
      await new Promise(r => setTimeout(r, 800));
      return { content: [{ type: "text", text: isOnline ? "Device online." : "Device offline." }] };
    }
  );

  return server;
}

const app = express();
app.use(express.json());

app.all("/mcp", async (req, res) => {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  res.on("close", async () => {
    await transport.close();
    await server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.get("/health", (req, res) => {
  res.json({ ok: true, online: isOnline });
});

connectWS();
app.listen(PORT, () => console.log(`MCP server on port ${PORT}`));
