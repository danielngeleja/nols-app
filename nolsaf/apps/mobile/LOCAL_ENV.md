# NoLSAF Mobile Local Environment

The mobile app reads public Expo environment variables at startup.

For local testing on desktop, Expo web, or iOS simulator:

```env
EXPO_PUBLIC_API_URL=http://localhost:4000
EXPO_PUBLIC_SOCKET_URL=http://localhost:4000
```

For Android emulator, `localhost` points to the emulator itself. Use:

```env
EXPO_PUBLIC_API_URL=http://10.0.2.2:4000
EXPO_PUBLIC_SOCKET_URL=http://10.0.2.2:4000
```

For a physical phone, use the computer LAN IP running the backend:

```env
EXPO_PUBLIC_API_URL=http://192.168.1.20:4000
EXPO_PUBLIC_SOCKET_URL=http://192.168.1.20:4000
```

Replace `192.168.1.20` with the actual computer IP on the same Wi-Fi network.

`apps/mobile/.env.local` is intentionally ignored by git so local testing cannot overwrite staging or production API targets.
