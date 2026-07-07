# Production mobile environment

Set these values in the EAS `production` environment before creating a store build.

```
EXPO_PUBLIC_API_URL=https://<production-api-origin>
EXPO_PUBLIC_SOCKET_URL=https://<production-api-origin>
EXPO_PUBLIC_MAPBOX_TOKEN=<public-mapbox-token>
```

Do not use localhost, LAN IPs, emulator IPs, or temporary preview hosts for production builds.
