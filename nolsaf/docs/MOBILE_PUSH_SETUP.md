# Mobile push security and activation

The API push worker deliberately stays off until `EXPO_PUSH_ACCESS_TOKEN` is set.
This value is a secret for the API server only. Do not put it in `app.json`,
`google-services.json`, an EAS public environment variable, source control, or
the mobile application.

1. In Expo, enable **Enhanced Security for Push Notifications** for the account
   that owns the **nolsaf** project. Create a project-accessible Expo token under
   **Account settings > Access Tokens**; a limited-role robot user is
   preferable to a personal token.
2. Store that token as `EXPO_PUSH_ACCESS_TOKEN` in the API's production secret
   store. Restart the API workers after the value is available. The worker is
   enabled by default in production unless `MOBILE_PUSH_ENABLED=false`.
3. Apply the `20261018190000_add_mobile_push_delivery` Prisma migration and
   deploy the API. Build and install a new Android app bundle with the Firebase
   configuration and `expo-notifications` plugin.
4. On a real Android device, sign in, grant notifications, trigger a test inbox
   notification, and check its Expo ticket and receipt. Verify that tapping it
   opens the authenticated inbox item, then verify that logout and the configured
   idle timeout stop further pushes.

Push previews contain only a generic message. The app fetches the notification
details through its authenticated API after the user opens it. A notification
already handed to Expo/FCM before logout cannot be recalled. If logout cannot
reach the API because the device is offline, the server may continue sending
generic alerts until the configured session idle or maximum duration expires.

The Firebase service account JSON uploaded to EAS is a private credential and
must never be added to the repository or sent to the mobile app. The Firebase
`google-services.json` file is Android application configuration, not that
service account key.
