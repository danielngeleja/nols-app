import { io, Socket } from "socket.io-client";

import { env } from "./env";
import { resolveLocalhostUrl } from "./localUrl";

function realtimeUrl() {
  return resolveLocalhostUrl(env.socketUrl || env.apiUrl);
}

export function connectCustomerRealtime(token: string): Socket | null {
  const url = realtimeUrl();
  if (!url || !token) return null;

  return io(url, {
    auth: { token },
    transports: ["websocket"],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
  });
}
