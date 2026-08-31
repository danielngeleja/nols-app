import { readFileSync } from "node:fs";

type ReadUtf8File = (path: string, encoding: "utf8") => string;

export function databaseSslCaFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
  readUtf8File: ReadUtf8File = readFileSync,
): string {
  const inlineCa = String(environment.DB_SSL_CA || "").replace(/\\n/g, "\n").trim();
  if (inlineCa) return inlineCa;

  const caFile = String(environment.DB_SSL_CA_FILE || "").trim();
  if (!caFile) return "";

  let fileCa: string;
  try {
    fileCa = readUtf8File(caFile, "utf8").trim();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read DB_SSL_CA_FILE at ${caFile}: ${reason}`);
  }

  if (!fileCa) {
    throw new Error(`DB_SSL_CA_FILE is empty: ${caFile}`);
  }
  return fileCa;
}
