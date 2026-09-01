import Redis from 'ioredis';
import { getRedisTlsOptions } from "./redisTls.js";

let client: Redis | null = null;
let connectionAttempts = 0;
let missingProductionConfigurationLogged = false;
const MAX_CONNECTION_ATTEMPTS = 3;
const CONNECTION_TIMEOUT = 5000; // 5 seconds

function resolveRedisUrl(): string | null {
  const configured = String(process.env.REDIS_URL || "").trim();
  if (configured) return configured;

  if (process.env.NODE_ENV === "production") {
    if (!missingProductionConfigurationLogged) {
      console.error(
        "[REDIS] REDIS_URL is not configured in production. Shared cache and worker leasing are unavailable.",
      );
      missingProductionConfigurationLogged = true;
    }
    return null;
  }

  return "redis://localhost:6379";
}

function createRedisClient(url: string): Redis {
  return new Redis(url, {
    ...getRedisTlsOptions(url),
    connectTimeout: CONNECTION_TIMEOUT,
    lazyConnect: true, // Connection happens automatically on first command
    retryStrategy: (times) => {
      if (times > MAX_CONNECTION_ATTEMPTS) {
        console.error(`[REDIS] Max connection attempts (${MAX_CONNECTION_ATTEMPTS}) reached. Giving up.`);
        return null; // Stop retrying
      }
      const delay = Math.min(times * 100, 3000); // Exponential backoff, max 3s
      console.warn(`[REDIS] Connection attempt ${times}/${MAX_CONNECTION_ATTEMPTS}. Retrying in ${delay}ms...`);
      return delay;
    },
    maxRetriesPerRequest: 2,
    enableOfflineQueue: true, // Queue commands while connecting - allows lazy connect to work properly
  });
}

export function getRedis(): Redis | null {
  if (!client) {
    try {
      const url = resolveRedisUrl();
      if (!url) return null;
      client = createRedisClient(url);
      connectionAttempts = 0;
      
      // Set up event handlers (only once when client is created)
      client.on('error', (err) => {
        // Filter out common connection-in-progress messages to reduce noise
        const errorMsg = err?.message || '';
        if (!errorMsg.includes('Connection is closed') && 
            !errorMsg.includes('already connecting') &&
            !errorMsg.includes('already connected')) {
          if (errorMsg.includes('ECONNREFUSED') || errorMsg.includes('ENOTFOUND')) {
            console.error('[REDIS] Redis server appears to be unavailable. Check REDIS_URL environment variable.');
          } else {
            console.error('[REDIS] Connection error:', errorMsg);
          }
        }
      });
      
      client.on('connect', () => {
        console.log('[REDIS] Connected successfully');
        connectionAttempts = 0; // Reset on successful connection
      });
      
      client.on('close', () => {
        // Connection closed - ioredis will reconnect automatically on next command
        console.warn('[REDIS] Connection closed');
      });
      
      client.on('ready', () => {
        console.log('[REDIS] Ready to accept commands');
        connectionAttempts = 0; // Reset on successful connection
      });
      
      // Eagerly connect so status reaches 'ready' before the first cache check
      client.connect().catch(() => {
        // Errors are handled by the 'error' event handler above
      });
    } catch (err: any) {
      console.error('[REDIS] Failed to create client:', err?.message || 'Unknown error');
      client = null;
    }
  }
  
  // Return client - connection will be established automatically on first command
  // If connection fails, commands will fail gracefully and retryStrategy will handle reconnection
  return client;
}
