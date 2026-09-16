# Apple Health MCP Tunnel

Remote tunnel for the `apple-health-mcp-unofficial` MCP server, following the same Railway WebSocket tunnel pattern as the Safari MCP.

## Architecture

```
Littlebird (cloud)
  | HTTPS POST to /mcp (Bearer auth via MCP_KEY)
Railway Hub (railway-hub.js)
  | WebSocket /tunnel (auth via TUNNEL_TOKEN)
Tunnel Client (tunnel-client.js, launchd on Mac)
  | HTTP to localhost:3001
apple-health-mcp-unofficial (--http mode)
  | reads export.xml from ~/apple-health-mcp-exports/
Apple Health Data (exported from iPhone)
```

## Files

| File | Purpose |
|------|--------|
| `railway-hub.js` | Railway WebSocket hub - HTTP /mcp + WS /tunnel |
| `package.json` | Railway deps (only `ws`) |
| `Dockerfile` | Railway container build |
| `tunnel-client.js` | Mac daemon - zero-dep, Node 22 native WebSocket |
| `setup.sh` | One-shot setup script for Mac |

## Env Vars

### Railway Hub
- `PORT` - auto-set by Railway
- `TUNNEL_TOKEN` - bearer auth for WS tunnel
- `MCP_KEY` - bearer auth for /mcp endpoint

### Mac Tunnel Client
- `APPLE_HEALTH_TUNNEL_URL` - wss:// URL of Railway hub /tunnel
- `TUNNEL_TOKEN` - must match Railway
- `APPLE_HEALTH_LOCAL_PORT` - local MCP server port (default 3001)
- `APPLE_HEALTH_LOCAL_HOST` - local MCP server host (default 127.0.0.1)

### Mac MCP Server (apple-health-mcp-unofficial)
- `APPLE_HEALTH_EXPORT_PATH` - directory containing export.xml
- `APPLE_HEALTH_PRIVACY_MODE` - summary | structured | raw
- `APPLE_HEALTH_MCP_HOST` - 127.0.0.1
- `APPLE_HEALTH_MCP_PORT` - 3001

## Setup

1. Clone: `git clone https://github.com/dbalchunas2-pixel/apple-health-mcp-tunnel.git ~/apple-health-mcp-tunnel`
2. Run: `bash ~/apple-health-mcp-tunnel/setup.sh`
3. Export Apple Health data from iPhone to `~/apple-health-mcp-exports/`
4. Create Railway service from this GitHub repo
5. Set Railway env vars (TUNNEL_TOKEN, MCP_KEY from `~/apple-health-mcp-tunnel/tokens.env`)
6. `launchctl load` both plists (paths printed by setup.sh)
7. Add custom MCP in Littlebird Settings

## Tools Exposed (via apple-health-mcp-unofficial)

- `apple_health_connection_status`
- `apple_health_data_inventory`
- `apple_health_daily_summary`
- `apple_health_weekly_summary`
- `apple_health_capabilities`
- `apple_health_agent_manifest`
- `apple_health_privacy_audit`
- `apple_health_list_records`
- `apple_health_list_workouts`
- `apple_health_reimport`
- `apple_health_daily_review` (prompt)
- `apple_health_weekly_review` (prompt)
