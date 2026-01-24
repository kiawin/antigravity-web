#!/bin/bash

# Antigravity Web - Mac/Linux Launcher
echo "==================================================="
echo "  Antigravity Web Launcher"
echo "==================================================="

# 1. Check for Node.js
if ! command -v node &> /dev/null
then
    echo "[ERROR] Node.js is not installed."
    echo "Please install it from https://nodejs.org/"
    read -p "Press Enter to exit..."
    exit 1
fi

# 2. Install dependencies if node_modules missing
if [ ! -d "node_modules" ]; then
    echo "[INFO] Installing dependencies..."
    npm install
    if [ $? -ne 0 ]; then
        echo "[ERROR] npm install failed."
        read -p "Press Enter to exit..."
        exit 1
    fi
fi

# 2.5 Update ~/.antigravity/argv.json
node <<'EOF'
const fs = require('fs');
const os = require('os');
const path = require('path');
const targetPath = path.join(os.homedir(), '.antigravity', 'argv.json');

if (fs.existsSync(targetPath)) {
    try {
        let content = fs.readFileSync(targetPath, 'utf8');
        const keyRegex = /"remote-debugging-port":\s*"([^"]+)"/;
        const match = content.match(keyRegex);
        
        if (match) {
            if (match[1] !== '9000') {
                console.log('[CONFIG] Updating remote-debugging-port to 9000 in argv.json');
                const newContent = content.replace(keyRegex, '"remote-debugging-port": "9000"');
                fs.writeFileSync(targetPath, newContent);
            }
        }
    } catch (e) {
        console.error('[ERROR] Failed to update argv.json:', e);
    }
}
EOF

# 3. Get Local IP Address
if [[ "$OSTYPE" == "darwin"* ]]; then
    MYIP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "localhost")
else
    MYIP=$(hostname -I 2>/dev/null | awk '{print $1}')
    if [ -z "$MYIP" ]; then
        MYIP="localhost"
    fi
fi

# 4. Check for SSL certificates
PROTOCOL="http"
if [ -f "certs/server.key" ] && [ -f "certs/server.cert" ]; then
    PROTOCOL="https"
    echo "[SSL] HTTPS enabled - secure connection available"
fi

echo ""
echo "[READY] Server will be available at:"
echo "      $PROTOCOL://$MYIP:3000"
echo ""

# Platform-specific tips
if [[ "$OSTYPE" == "darwin"* ]]; then
    echo "[TIP] For Right-Click on macOS, see README.md for Automator Quick Action setup."
else
    echo "[TIP] For Linux Right-Click (Nautilus), run: ./install_context_menu.sh"
fi
if [ "$PROTOCOL" = "http" ]; then
    echo "[TIP] To enable HTTPS, run: node generate_ssl.js"
fi
echo ""

echo "[STARTING] Launching monitor server..."
echo ""
node server.js

# Keep terminal open if server crashes
echo ""
echo "[INFO] Server stopped."
read -p "Press Enter to exit..."

