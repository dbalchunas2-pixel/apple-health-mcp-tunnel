#!/bin/bash
# Apple Health MCP Setup Script
# For David Balchunas - Sep 15 2026
#
# This script:
# 1. Creates Apple Health export directory
# 2. Generates auth tokens for Railway tunnel
# 3. Pre-caches the apple-health-mcp-unofficial npm package
# 4. Creates launchd plists for MCP server + tunnel client
# 5. Prints next steps
#
# Run: bash ~/apple-health-mcp-tunnel/setup.sh

set -e

REPO_DIR="$HOME/apple-health-mcp-tunnel"
EXPORT_DIR="$HOME/apple-health-mcp-exports"
NODE_PATH=$(which node)
NPX_PATH=$(which npx)

echo "========================================"
echo "  Apple Health MCP Setup"
echo "========================================"
echo ""

# Check Node version
NODE_VERSION=$($NODE_PATH --version)
echo "[1/7] Node.js: $NODE_VERSION at $NODE_PATH"
if [[ ! "$NODE_VERSION" =~ v2[2-9] ]]; then
  echo "WARNING: Node 22+ recommended. You have $NODE_VERSION"
fi
echo ""

# Create export directory
echo "[2/7] Creating Apple Health export directory..."
mkdir -p "$EXPORT_DIR"
echo "  -> $EXPORT_DIR"
echo "  Place your export.xml (or export.zip) here after exporting from iPhone"
echo ""

# Generate auth tokens
echo "[3/7] Generating auth tokens..."
TUNNEL_TOKEN=$(openssl rand -hex 32)
MCP_KEY=$(openssl rand -hex 32)
echo "  TUNNEL_TOKEN: $TUNNEL_TOKEN"
echo "  MCP_KEY: $MCP_KEY"
echo ""

# Save tokens to a config file for reference
cat > "$REPO_DIR/tokens.env" << 'TOKENSEOF'
# Apple Health MCP Tunnel Tokens
# Keep these secret!

# For Railway hub env vars:
TUNNEL_TOKEN=__TUNNEL_TOKEN__
MCP_KEY=__MCP_KEY__

# For Mac tunnel client:
APPLE_HEALTH_TUNNEL_URL=wss://apple-health-mcp-tunnel-production.up.railway.app/tunnel
# TUNNEL_TOKEN same as above

# For Littlebird custom MCP:
# URL: https://apple-health-mcp-tunnel-production.up.railway.app/mcp
# Auth: Bearer __MCP_KEY__
TOKENSEOF

sed -i "" "s/__TUNNEL_TOKEN__/$TUNNEL_TOKEN/g" "$REPO_DIR/tokens.env"
sed -i "" "s/__MCP_KEY__/$MCP_KEY/g" "$REPO_DIR/tokens.env"
echo "  Tokens saved to $REPO_DIR/tokens.env"
echo ""

# Pre-cache the npx package
echo "[4/7] Pre-caching apple-health-mcp-unofficial package..."
$NPX_PATH -y apple-health-mcp-unofficial doctor 2>/dev/null || true
echo "  Done (warnings above are OK if no export.xml yet)"
echo ""

# Save env config
echo "[5/7] Saving environment config..."
cat > "$REPO_DIR/health-mcp.env" << 'HEALTHENVEOF'
export APPLE_HEALTH_EXPORT_PATH=__EXPORT_DIR__
export APPLE_HEALTH_PRIVACY_MODE=summary
export APPLE_HEALTH_MCP_HOST=127.0.0.1
export APPLE_HEALTH_MCP_PORT=3001
HEALTHENVEOF
sed -i "" "s|__EXPORT_DIR__|$EXPORT_DIR|g" "$REPO_DIR/health-mcp.env"
echo "  Config saved to $REPO_DIR/health-mcp.env"
echo ""

# Create launchd plist for the Apple Health MCP server
echo "[6/7] Creating launchd plists..."
PLIST_MCP="$HOME/Library/LaunchAgents/com.dbalchunas.apple-health-mcp-server.plist"
cat > "$PLIST_MCP" << 'MCPPLISTEOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.dbalchunas.apple-health-mcp-server</string>
  <key>ProgramArguments</key>
  <array>
    <string>__NPX_PATH__</string>
    <string>-y</string>
    <string>apple-health-mcp-unofficial</string>
    <string>--http</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>APPLE_HEALTH_EXPORT_PATH</key>
    <string>__EXPORT_DIR__</string>
    <key>APPLE_HEALTH_PRIVACY_MODE</key>
    <string>summary</string>
    <key>APPLE_HEALTH_MCP_HOST</key>
    <string>127.0.0.1</string>
    <key>APPLE_HEALTH_MCP_PORT</key>
    <string>3001</string>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>__HOME__/apple-health-mcp-tunnel/mcp-server.log</string>
  <key>StandardErrorPath</key>
  <string>__HOME__/apple-health-mcp-tunnel/mcp-server-error.log</string>
</dict>
</plist>
MCPPLISTEOF
sed -i "" "s|__NPX_PATH__|$NPX_PATH|g" "$PLIST_MCP"
sed -i "" "s|__EXPORT_DIR__|$EXPORT_DIR|g" "$PLIST_MCP"
sed -i "" "s|__HOME__|$HOME|g" "$PLIST_MCP"
echo "  MCP server plist: $PLIST_MCP"

# Create launchd plist for the tunnel client
PLIST_TUNNEL="$HOME/Library/LaunchAgents/com.dbalchunas.apple-health-tunnel.plist"
cat > "$PLIST_TUNNEL" << 'TUNNELPLISTEOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.dbalchunas.apple-health-tunnel</string>
  <key>ProgramArguments</key>
  <array>
    <string>__NODE_PATH__</string>
    <string>__HOME__/apple-health-mcp-tunnel/tunnel-client.js</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>APPLE_HEALTH_TUNNEL_URL</key>
    <string>wss://apple-health-mcp-tunnel-production.up.railway.app/tunnel</string>
    <key>TUNNEL_TOKEN</key>
    <string>__TUNNEL_TOKEN__</string>
    <key>APPLE_HEALTH_LOCAL_PORT</key>
    <string>3001</string>
    <key>APPLE_HEALTH_LOCAL_HOST</key>
    <string>127.0.0.1</string>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>__HOME__/apple-health-mcp-tunnel/tunnel-client.log</string>
  <key>StandardErrorPath</key>
  <string>__HOME__/apple-health-mcp-tunnel/tunnel-client-error.log</string>
</dict>
</plist>
TUNNELPLISTEOF
sed -i "" "s|__NODE_PATH__|$NODE_PATH|g" "$PLIST_TUNNEL"
sed -i "" "s|__HOME__|$HOME|g" "$PLIST_TUNNEL"
sed -i "" "s|__TUNNEL_TOKEN__|$TUNNEL_TOKEN|g" "$PLIST_TUNNEL"
echo "  Tunnel client plist: $PLIST_TUNNEL"
echo ""

# Final instructions
echo "[7/7] Setup complete!"
echo ""
echo "========================================"
echo "  NEXT STEPS"
echo "========================================"
echo ""
echo "1. EXPORT APPLE HEALTH DATA FROM iPHONE:"
echo "   Settings > Privacy & Security > Health > Export Health Data"
echo "   Wait for export (can take several minutes)"
echo "   AirDrop or copy the export.xml to:"
echo "   $EXPORT_DIR/"
echo ""
echo "2. DEPLOY RAILWAY HUB:"
echo "   Create Railway service from this GitHub repo"
echo "   Set env vars on Railway: TUNNEL_TOKEN and MCP_KEY"
echo "   (values in $REPO_DIR/tokens.env)"
echo ""
echo "3. LOAD LAUNCHD SERVICES:"
echo "   launchctl load $PLIST_MCP"
echo "   launchctl load $PLIST_TUNNEL"
echo ""
echo "4. ADD TO LITTLEBIRD:"
echo "   Settings > Integrations > Add Custom MCP"
echo "   URL: https://apple-health-mcp-tunnel-production.up.railway.app/mcp"
echo "   Auth: Bearer (MCP_KEY from tokens.env)"
echo ""
echo "5. VERIFY:"
echo "   curl http://127.0.0.1:3001/health   (local MCP server)"
echo "   curl https://apple-health-mcp-tunnel-production.up.railway.app/health  (Railway hub)"
echo ""
echo "========================================"
