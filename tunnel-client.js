#!/usr/bin/env node
/**
 * Apple Health MCP Tunnel Client (Mac side)
 * 
 * Connects to Railway hub via WebSocket, forwards HTTP requests
 * to the local apple-health-mcp-unofficial server running in HTTP mode.
 * 
 * Zero external dependencies - uses Node 22 native WebSocket.
 * 
 * Env vars:
 *   APPLE_HEALTH_TUNNEL_URL - wss:// URL of Railway hub /tunnel
 *   TUNNEL_TOKEN - bearer token for WS auth
 *   APPLE_HEALTH_LOCAL_PORT - local MCP server port (default 3001)
 *   APPLE_HEALTH_LOCAL_HOST - local MCP server host (default 127.0.0.1)
 */

const http = require('http');

const TUNNEL_URL = process.env.APPLE_HEALTH_TUNNEL_URL;
const TUNNEL_TOKEN = process.env.TUNNEL_TOKEN;
const LOCAL_PORT = parseInt(process.env.APPLE_HEALTH_LOCAL_PORT || '3001', 10);
const LOCAL_HOST = process.env.APPLE_HEALTH_LOCAL_HOST || '127.0.0.1';

if (!TUNNEL_URL || !TUNNEL_TOKEN) {
  console.error('[Tunnel] Missing APPLE_HEALTH_TUNNEL_URL or TUNNEL_TOKEN');
  process.exit(1);
}

let ws = null;
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 30000;

function forwardToLocal(reqMsg) {
  return new Promise((resolve) => {
    const options = {
      hostname: LOCAL_HOST,
      port: LOCAL_PORT,
      method: reqMsg.method,
      path: reqMsg.url,
      headers: reqMsg.headers || {},
      timeout: 25000,
    };

    const proxyReq = http.request(options, (proxyRes) => {
      let body = '';
      proxyRes.on('data', (chunk) => { body += chunk; });
      proxyRes.on('end', () => {
        const headers = {};
        for (const [key, value] of Object.entries(proxyRes.headers)) {
          if (key !== 'transfer-encoding' && key !== 'connection') {
            headers[key] = value;
          }
        }
        resolve({
          type: 'http-response',
          id: reqMsg.id,
          status: proxyRes.statusCode,
          headers,
          body,
        });
      });
    });

    proxyReq.on('error', (err) => {
      console.error(`[Tunnel] Forward error for req ${reqMsg.id}: ${err.message}`);
      resolve({
        type: 'http-response',
        id: reqMsg.id,
        status: 502,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: `Local server error: ${err.message}` }),
      });
    });

    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      resolve({
        type: 'http-response',
        id: reqMsg.id,
        status: 504,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Local server timeout' }),
      });
    });

    if (reqMsg.body) {
      proxyReq.write(reqMsg.body);
    }
    proxyReq.end();
  });
}

function connect() {
  console.log(`[Tunnel] Connecting to ${TUNNEL_URL}...`);
  
  const urlWithToken = TUNNEL_URL + (TUNNEL_URL.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(TUNNEL_TOKEN);
  
  ws = new WebSocket(urlWithToken);

  ws.onopen = () => {
    console.log(`[Tunnel] Connected to Railway hub at ${new Date().toISOString()}`);
    reconnectDelay = 1000;
  };

  ws.onmessage = async (event) => {
    try {
      const msg = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());
      
      if (msg.type === 'http-request') {
        console.log(`[Tunnel] Forwarding ${msg.method} ${msg.url} (id=${msg.id})`);
        const response = await forwardToLocal(msg);
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify(response));
        }
      } else if (msg.type === 'heartbeat-ping') {
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'heartbeat' }));
        }
      } else if (msg.type === 'heartbeat-ack') {
        // Acknowledged
      }
    } catch (e) {
      console.error('[Tunnel] Message parse error:', e.message);
    }
  };

  ws.onclose = (event) => {
    console.log(`[Tunnel] Disconnected (code=${event.code}). Reconnecting in ${reconnectDelay}ms...`);
    ws = null;
    setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
      connect();
    }, reconnectDelay);
  };

  ws.onerror = (err) => {
    console.error('[Tunnel] WebSocket error:', err.message || 'unknown error');
  };
}

setInterval(() => {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'heartbeat' }));
  }
}, 25000);

process.on('SIGINT', () => {
  console.log('[Tunnel] Shutting down...');
  if (ws) ws.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('[Tunnel] SIGTERM received, shutting down...');
  if (ws) ws.close();
  process.exit(0);
});

connect();
