#!/usr/bin/env node
/**
 * Apple Health MCP Railway Hub
 * 
 * HTTP /mcp  -> forwards to Mac tunnel client via WebSocket
 * WS  /tunnel -> Mac tunnel client connects here
 * GET /health -> health check
 * 
 * Env vars:
 *   PORT - Railway port (auto-set)
 *   TUNNEL_TOKEN - bearer auth for WS tunnel
 *   MCP_KEY - bearer auth for /mcp endpoint
 */

const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const TUNNEL_TOKEN = process.env.TUNNEL_TOKEN;
const MCP_KEY = process.env.MCP_KEY;

if (!TUNNEL_TOKEN || !MCP_KEY) {
  console.error('Missing TUNNEL_TOKEN or MCP_KEY env vars');
  process.exit(1);
}

let tunnel = null;
let requestId = 0;
const pending = new Map();

const wss = new WebSocketServer({ noServer: true });

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      tunnelConnected: !!tunnel,
      uptime: process.uptime(),
    }));
    return;
  }

  if (req.url === '/mcp' || req.url.startsWith('/mcp?')) {
    const auth = req.headers['authorization'];
    if (MCP_KEY && auth !== `Bearer ${MCP_KEY}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    if (!tunnel || tunnel.readyState !== 1) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Mac tunnel not connected' }));
      return;
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const id = ++requestId;
      const headers = {};
      for (const [key, value] of Object.entries(req.headers)) {
        if (key !== 'host' && key !== 'authorization' && key !== 'connection') {
          headers[key] = value;
        }
      }

      const tunnelMsg = {
        type: 'http-request',
        id,
        method: req.method,
        url: req.url,
        headers,
        body,
      };

      pending.set(id, { res, timer: null });
      
      pending.get(id).timer = setTimeout(() => {
        if (pending.has(id)) {
          const p = pending.get(id);
          pending.delete(id);
          if (!p.res.writableEnded) {
            p.res.writeHead(504, { 'Content-Type': 'application/json' });
            p.res.end(JSON.stringify({ error: 'Gateway timeout' }));
          }
        }
      }, 30000);

      tunnel.send(JSON.stringify(tunnelMsg));
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  
  if (url.pathname !== '/tunnel') {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }

  const auth = req.headers['authorization'];
  const tokenFromQuery = url.searchParams.get('token');
  const token = auth ? auth.replace('Bearer ', '') : tokenFromQuery;
  
  if (token !== TUNNEL_TOKEN) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    console.log(`[Tunnel] Client connected at ${new Date().toISOString()}`);
    
    if (tunnel && tunnel.readyState === 1) {
      tunnel.close();
    }
    tunnel = ws;

    for (const [id, p] of pending) {
      if (!p.res.writableEnded) {
        p.res.writeHead(503, { 'Content-Type': 'application/json' });
        p.res.end(JSON.stringify({ error: 'Tunnel reconnected' }));
      }
    }
    pending.clear();

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        
        if (msg.type === 'http-response') {
          const p = pending.get(msg.id);
          if (p) {
            clearTimeout(p.timer);
            pending.delete(msg.id);
            
            if (!p.res.writableEnded) {
              const headers = msg.headers || {};
              p.res.writeHead(msg.status || 200, headers);
              p.res.end(msg.body || '');
            }
          }
        } else if (msg.type === 'heartbeat') {
          ws.send(JSON.stringify({ type: 'heartbeat-ack' }));
        }
      } catch (e) {
        console.error('[Tunnel] Parse error:', e.message);
      }
    });

    ws.on('close', () => {
      console.log(`[Tunnel] Client disconnected at ${new Date().toISOString()}`);
      if (tunnel === ws) tunnel = null;
      
      for (const [id, p] of pending) {
        if (!p.res.writableEnded) {
          p.res.writeHead(503, { 'Content-Type': 'application/json' });
          p.res.end(JSON.stringify({ error: 'Tunnel disconnected' }));
        }
      }
      pending.clear();
    });

    ws.on('error', (err) => {
      console.error('[Tunnel] Error:', err.message);
    });
  });
});

server.listen(PORT, () => {
  console.log(`[Hub] Apple Health MCP Railway hub listening on port ${PORT}`);
  console.log(`[Hub] MCP endpoint: POST /mcp (Bearer auth)`);
  console.log(`[Hub] Tunnel endpoint: WS /tunnel (Bearer auth)`);
  console.log(`[Hub] Health check: GET /health`);
});

setInterval(() => {
  if (tunnel && tunnel.readyState === 1) {
    tunnel.send(JSON.stringify({ type: 'heartbeat-ping' }));
  }
}, 25000);
