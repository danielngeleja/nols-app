# NoLSAF Mobile Local Environment

The mobile app reads public Expo environment variables at startup.

For local testing, keep the URLs on the standard localhost ports:

```env
EXPO_PUBLIC_API_URL=http://localhost:4000
EXPO_PUBLIC_WEB_URL=http://localhost:3000
EXPO_PUBLIC_SOCKET_URL=http://localhost:4000
```

The native app resolves those localhost URLs automatically during development:

- Android Emulator uses `10.0.2.2`.
- A physical Android or iOS device uses the computer address reported by Metro.
- Expo web and desktop development continue to use `localhost`.

If Metro is running through a tunnel or cannot report the LAN address, set the
computer LAN IP explicitly:

```env
EXPO_PUBLIC_API_URL=http://192.168.1.20:4000
EXPO_PUBLIC_WEB_URL=http://192.168.1.20:3000
EXPO_PUBLIC_SOCKET_URL=http://192.168.1.20:4000
```

Replace `192.168.1.20` with the actual computer IP on the same Wi-Fi network.

The API and web processes must also be running. From the monorepo root:

```powershell
npm run dev
```

The mobile app reads approved properties and authentication directly from the
API on port `4000`; it does not scrape or copy them from the web page on port
`3000`. Both clients display data from the same backend database.

`apps/mobile/.env.local` is intentionally ignored by git so local testing cannot overwrite staging or production API targets.
