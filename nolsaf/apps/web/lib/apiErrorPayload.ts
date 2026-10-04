/** Axios returns even JSON failures as Blobs when downloading a file. */
export async function decodeApiErrorPayload(data: unknown): Promise<unknown> {
  if (typeof Blob === "undefined" || !(data instanceof Blob) || data.size > 65536) return data;
  try {
    const parsed: unknown = JSON.parse(await data.text());
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : data;
  } catch {
    return data;
  }
}
