type QueryLike = Record<string, unknown>;

function queryText(value: unknown): string | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  const text = typeof candidate === "string" ? candidate.trim() : "";
  return text || undefined;
}

/** Exact stable codes take precedence; roomType remains for legacy clients. */
export function publicAvailabilityRoomFilter(query: QueryLike): {
  roomCode: string | null;
  roomType: string | undefined;
} {
  const roomCode = queryText(query.roomCode);
  if (roomCode) return { roomCode, roomType: undefined };
  return { roomCode: null, roomType: queryText(query.roomType) };
}
