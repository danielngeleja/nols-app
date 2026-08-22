import { configureApiClient } from "@nolsaf/native-ui";

import { env } from "./env";

configureApiClient({ apiUrl: env.apiUrl, client: "DRIVER_APP" });

export { apiBaseUrl, apiRequest, apiUploadFile, getErrorMessage } from "@nolsaf/native-ui";
export type { ApiError } from "@nolsaf/native-ui";
