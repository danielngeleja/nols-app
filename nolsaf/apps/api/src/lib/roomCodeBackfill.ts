import {
  effectiveRoomSelectionCode,
  ensureRoomsSpecCodes,
  existingRoomCode,
  roomsSpecEntries,
  roomTypeNameFor,
} from "./roomSelectionCode.js";

export type RoomCodeReferenceKind = "booking" | "availabilityBlock";

export interface RoomCodeReference {
  kind: RoomCodeReferenceKind;
  id: number;
  roomCode: string | null;
  /** Active references can affect current/future sellable inventory. */
  active: boolean;
}

export type RoomCodeResolution =
  | { status: "unchanged"; code: string | null; reason: string }
  | { status: "update"; code: string; reason: string }
  | { status: "ambiguous"; code: string; candidates: string[]; reason: string }
  | { status: "unknown"; code: string; reason: string };

export interface RoomCodeReferenceDecision extends RoomCodeReference {
  resolution: RoomCodeResolution;
}

export interface RoomCodeBackfillPlan {
  before: unknown;
  after: unknown;
  roomsSpecChanged: boolean;
  decisions: RoomCodeReferenceDecision[];
  updates: Array<RoomCodeReference & { targetCode: string }>;
  activeBlockers: RoomCodeReferenceDecision[];
  unresolvedHistorical: RoomCodeReferenceDecision[];
  codes: string[];
}

function canonical(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function codeSnapshot(value: unknown): string[] {
  return roomsSpecEntries(value).map((entry) => existingRoomCode(entry) ?? "");
}

function codesChanged(before: unknown, after: unknown): boolean {
  const left = codeSnapshot(before);
  const right = codeSnapshot(after);
  return left.length !== right.length || left.some((code, index) => code !== right[index]);
}

/**
 * Resolve one persisted reference without guessing.
 *
 * Exact codes that already existed before the backfill and real RoomUnit codes
 * are preserved. Numeric legacy selections map by the exact stored array index.
 * A bare legacy room type maps automatically only when that type has one
 * current variant. Multiple candidates are returned as an operator blocker.
 */
export function resolveRoomCodeForBackfill(
  storedRoomCode: string | null | undefined,
  before: unknown,
  after: unknown,
  protectedRoomUnitCodes: Iterable<string> = [],
): RoomCodeResolution {
  const raw = String(storedRoomCode ?? "").trim();
  if (!raw) return { status: "unchanged", code: null, reason: "unassigned" };

  const protectedCodes = new Set(Array.from(protectedRoomUnitCodes, canonical));
  if (protectedCodes.has(canonical(raw))) {
    return { status: "unchanged", code: raw, reason: "physical_room_unit" };
  }

  const explicitBeforeCodes = new Set(
    roomsSpecEntries(before)
      .map(existingRoomCode)
      .filter((code): code is string => !!code)
      .map(canonical),
  );
  if (explicitBeforeCodes.has(canonical(raw))) {
    return { status: "unchanged", code: raw, reason: "existing_explicit_code" };
  }

  if (/^\d+$/.test(raw)) {
    const index = Number(raw);
    const entry = roomsSpecEntries(after)[index];
    if (entry) {
      const target = effectiveRoomSelectionCode(entry);
      return canonical(target) === canonical(raw)
        ? { status: "unchanged", code: raw, reason: "numeric_code_already_current" }
        : { status: "update", code: target, reason: "legacy_array_index" };
    }
  }

  const candidates = roomsSpecEntries(after)
    .filter((entry) => canonical(roomTypeNameFor(entry)) === canonical(raw))
    .map(effectiveRoomSelectionCode)
    .filter((code, index, all) => all.findIndex((other) => canonical(other) === canonical(code)) === index);

  if (candidates.length === 1) {
    const target = candidates[0];
    return canonical(target) === canonical(raw)
      ? { status: "unchanged", code: raw, reason: "legacy_type_equals_current_code" }
      : { status: "update", code: target, reason: "unique_legacy_room_type" };
  }
  if (candidates.length > 1) {
    return {
      status: "ambiguous",
      code: raw,
      candidates,
      reason: "legacy_room_type_has_multiple_variants",
    };
  }

  const exactCurrent = roomsSpecEntries(after).some(
    (entry) => canonical(effectiveRoomSelectionCode(entry)) === canonical(raw),
  );
  if (exactCurrent) {
    return { status: "unchanged", code: raw, reason: "current_stable_code" };
  }

  return { status: "unknown", code: raw, reason: "not_a_rooms_spec_reference" };
}

export function buildRoomCodeBackfillPlan(input: {
  roomsSpec: unknown;
  references: RoomCodeReference[];
  protectedRoomUnitCodes?: Iterable<string>;
}): RoomCodeBackfillPlan {
  const before = input.roomsSpec;
  const after = ensureRoomsSpecCodes(before);
  const protectedCodes = input.protectedRoomUnitCodes ?? [];
  const decisions = input.references.map((reference) => ({
    ...reference,
    resolution: resolveRoomCodeForBackfill(
      reference.roomCode,
      before,
      after,
      protectedCodes,
    ),
  }));

  const updates = decisions.flatMap((decision) =>
    decision.resolution.status === "update"
      ? [{
          kind: decision.kind,
          id: decision.id,
          roomCode: decision.roomCode,
          active: decision.active,
          targetCode: decision.resolution.code,
        }]
      : [],
  );
  const unresolved = decisions.filter((decision) =>
    decision.resolution.status === "ambiguous" || decision.resolution.status === "unknown",
  );

  return {
    before,
    after,
    roomsSpecChanged: codesChanged(before, after),
    decisions,
    updates,
    activeBlockers: unresolved.filter((decision) => decision.active),
    unresolvedHistorical: unresolved.filter((decision) => !decision.active),
    codes: roomsSpecEntries(after).map(effectiveRoomSelectionCode),
  };
}
