/**
 * Utility Functions
 */

import os from "os";

/**
 * Get local IP address for mobile access
 * Prefers real network IPs (192.168.x.x, 10.x.x.x) over virtual adapters
 */
export function getLocalIP() {
  const interfaces = os.networkInterfaces();
  const candidates = [];

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        candidates.push({
          address: iface.address,
          priority: iface.address.startsWith("192.168.")
            ? 1
            : iface.address.startsWith("10.")
              ? 2
              : iface.address.startsWith("172.")
                ? 3
                : 4,
        });
      }
    }
  }
  candidates.sort((a, b) => a.priority - b.priority);
  return candidates.length > 0 ? candidates[0].address : "localhost";
}

/**
 * Simple hash function for change detection
 */
export function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash &= hash;
  }
  return hash.toString(36);
}
