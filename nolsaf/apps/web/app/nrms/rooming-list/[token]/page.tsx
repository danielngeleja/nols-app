"use client";
// The agency's rooming list. One link, no account: the tour operator types who
// is staying and sends it to the property.
//
// Lives outside app/public on purpose, the same way the guest payment link
// does, so it never inherits the NoLSAF marketing header and footer. This page
// carries its own portal chrome instead.
//
// Nothing typed here books anything. The property reviews the names and turns
// the accepted ones into stays, which is why this page never shows rates,
// availability or anyone else's booking.
import { use, useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import apiClient from "@/lib/apiClient";
import {
  AlertTriangle,
  ArrowUpRight,
  BedDouble,
  CalendarClock,
  Check,
  CheckCircle2,
  Loader2,
  Lock,
  Plus,
  Send,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";

type PublicRow = {
  id: number;
  blockRoomId: number | null;
  fullName: string;
  phone: string | null;
  email: string | null;
  nationality: string | null;
  adults: number;
  children: number;
  sharingWith: string | null;
  notes: string | null;
  status: string;
  rejectionReason: string | null;
  locked: boolean;
};

type PublicRoomType = { blockRoomId: number; roomTypeName: string; quantity: number; remaining: number };

type PublicList = {
  status: string;
  expiresAt: string;
  instructions: string | null;
  deskNotes: string | null;
  submittedAt: string | null;
  submitterName: string | null;
  submitterEmail: string | null;
  property: string;
  block: { name: string; reference: string; agencyName: string | null; checkIn: string; checkOut: string; nights: number; namesDueBy: string };
  roomTypes: PublicRoomType[];
  rows: PublicRow[];
};

type Draft = {
  key: string;
  blockRoomId: number | "";
  fullName: string;
  phone: string;
  email: string;
  nationality: string;
  adults: number;
  children: number;
  sharingWith: string;
  notes: string;
  rejectionReason: string | null;
};

const fieldCls =
  "box-border h-11 w-full min-w-0 max-w-full rounded-lg border border-solid border-neutral-300 bg-white px-3.5 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-emerald-600 focus:ring-4 focus:ring-emerald-600/10";

const selectCls =
  "box-border h-11 w-full min-w-0 max-w-full cursor-pointer rounded-lg border border-solid border-neutral-300 bg-white px-3 text-sm text-neutral-900 outline-none transition focus:border-emerald-600 focus:ring-4 focus:ring-emerald-600/10";

const labelCls = "mb-1.5 flex items-center gap-1 text-xs font-semibold text-neutral-700";

let draftSeed = 0;
function emptyDraft(blockRoomId: number | "" = ""): Draft {
  draftSeed += 1;
  return {
    key: `draft-${draftSeed}`,
    blockRoomId,
    fullName: "",
    phone: "",
    email: "",
    nationality: "",
    adults: 1,
    children: 0,
    sharingWith: "",
    notes: "",
    rejectionReason: null,
  };
}

function toDraft(row: PublicRow): Draft {
  draftSeed += 1;
  return {
    key: `row-${row.id}-${draftSeed}`,
    blockRoomId: row.blockRoomId ?? "",
    fullName: row.fullName,
    phone: row.phone ?? "",
    email: row.email ?? "",
    nationality: row.nationality ?? "",
    adults: row.adults,
    children: row.children,
    sharingWith: row.sharingWith ?? "",
    notes: row.notes ?? "",
    rejectionReason: row.status === "REJECTED" ? row.rejectionReason : null,
  };
}

function fmtDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function fmtShortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

type FieldIssues = Partial<Record<"fullName" | "phone" | "nationality" | "email", string>>;

// Kept deliberately loose: this only has to catch the typo the API would reject
// anyway, and a stricter pattern would refuse addresses that really exist.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The same rules the API enforces, checked here first. Letting the server be
 * the only validator meant one mistyped email failed the whole list with a
 * message that named neither the guest nor the field.
 */
function draftIssues(draft: Draft): FieldIssues {
  const issues: FieldIssues = {};
  if (draft.fullName.trim().length < 2) issues.fullName = "Enter the guest's full name";
  if (draft.phone.trim().length < 7) issues.phone = "Enter a phone number of at least 7 digits";
  if (draft.nationality.trim().length < 2) issues.nationality = "Enter the guest's nationality";
  const email = draft.email.trim();
  if (email && !EMAIL_PATTERN.test(email)) issues.email = "Enter a valid email address or leave it blank";
  return issues;
}

/** A guest row is only worth sending once it carries the details the desk needs to act on it. */
function draftComplete(draft: Draft): boolean {
  return Object.keys(draftIssues(draft)).length === 0;
}

function draftStarted(draft: Draft): boolean {
  return draft.fullName.trim().length > 0 || draft.phone.trim().length > 0 || draft.nationality.trim().length > 0 || draft.email.trim().length > 0;
}

export default function PublicRoomingListPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [list, setList] = useState<PublicList | null>(null);
  const [readOnly, setReadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [submitterName, setSubmitterName] = useState("");
  const [submitterEmail, setSubmitterEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [touched, setTouched] = useState(false);
  const [submitterIssue, setSubmitterIssue] = useState<{ field: "submitterName" | "submitterEmail"; message: string } | null>(null);
  // Field problems the API found that this page did not, keyed by draft so they
  // survive rows being added or removed. Cleared field by field as they are fixed.
  const [serverIssues, setServerIssues] = useState<Record<string, FieldIssues>>({});

  const seed = useCallback((next: PublicList) => {
    const editable = next.rows.filter((row) => !row.locked);
    if (editable.length) {
      setDrafts(editable.map(toDraft));
      return;
    }
    // A first-time list opens with one line per room still waiting for a name,
    // so the agency fills a form rather than building one.
    const blanks: Draft[] = [];
    for (const roomType of next.roomTypes) {
      const already = next.rows.filter((row) => row.locked && row.blockRoomId === roomType.blockRoomId).length;
      for (let index = 0; index < Math.max(0, roomType.remaining - already); index += 1) blanks.push(emptyDraft(roomType.blockRoomId));
    }
    setDrafts(blanks.length ? blanks.slice(0, 60) : [emptyDraft()]);
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .get<any>(`/api/public/nrms/rooming-lists/${encodeURIComponent(token)}`)
      .then((response) => {
        if (cancelled) return;
        const next: PublicList = response.data?.roomingList;
        setList(next);
        setReadOnly(Boolean(response.data?.readOnly));
        setSubmitterName(next?.submitterName ?? "");
        setSubmitterEmail(next?.submitterEmail ?? "");
        seed(next);
      })
      .catch((error: any) => {
        if (!cancelled) setLoadError(error?.response?.data?.error || "This rooming list link is not available. Ask the property for a new one.");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [seed, token]);

  const lockedRows = useMemo(() => (list?.rows ?? []).filter((row) => row.locked), [list]);
  const startedDrafts = useMemo(() => drafts.filter(draftStarted), [drafts]);
  const completeDrafts = useMemo(() => startedDrafts.filter(draftComplete), [startedDrafts]);
  const incompleteCount = startedDrafts.length - completeDrafts.length;
  const roomsBooked = useMemo(() => (list?.roomTypes ?? []).reduce((sum, roomType) => sum + roomType.quantity, 0), [list]);
  const namedCount = completeDrafts.length + lockedRows.length;
  const problemGuests = useMemo(
    () => drafts
      .filter((draft) => (draftStarted(draft) && !draftComplete(draft)) || Object.keys(serverIssues[draft.key] ?? {}).length > 0)
      .map((draft) => draft.key),
    [drafts, serverIssues],
  );

  const setDraft = (index: number, patch: Partial<Draft>) => {
    setSaved(false);
    // Editing a field answers whatever the server said about it, so the message
    // disappears as it is fixed rather than lingering until the next send.
    const draft = drafts[index];
    const stale = draft ? serverIssues[draft.key] : undefined;
    if (draft && stale && Object.keys(patch).some((field) => field in stale)) {
      setServerIssues((issues) => {
        const next = { ...(issues[draft.key] ?? {}) };
        for (const field of Object.keys(patch)) delete next[field as keyof FieldIssues];
        return { ...issues, [draft.key]: next };
      });
    }
    setDrafts((current) => current.map((item, position) => (position === index ? { ...item, ...patch } : item)));
  };

  /** Puts the first unfinished guest on screen instead of leaving them to hunt for it. */
  const revealFirstProblem = (keys: string[]) => {
    if (typeof document === "undefined") return;
    const target = keys.map((key) => document.getElementById(`guest-${key}`)).find(Boolean);
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const submit = async () => {
    setTouched(true);
    setSaveError(null);
    setSubmitterIssue(null);

    if (submitterName.trim().length < 2) {
      const message = "Enter your name so the desk knows who sent this list";
      setSubmitterIssue({ field: "submitterName", message });
      return setSaveError(message);
    }
    const submitterEmailValue = submitterEmail.trim();
    if (submitterEmailValue && !EMAIL_PATTERN.test(submitterEmailValue)) {
      const message = "Enter a valid email address or leave it blank";
      setSubmitterIssue({ field: "submitterEmail", message });
      return setSaveError(message);
    }
    if (!startedDrafts.length) return setSaveError("Add at least one guest before sending the list");
    if (incompleteCount > 0) {
      revealFirstProblem(startedDrafts.filter((draft) => !draftComplete(draft)).map((draft) => draft.key));
      return setSaveError(`${incompleteCount} ${incompleteCount === 1 ? "guest still needs" : "guests still need"} attention. Each one is marked below.`);
    }

    // The order sent is the order the API reports problems against, so it is
    // captured here to map any row issue back to the right card.
    const payload = startedDrafts;
    setSaving(true);
    try {
      const response = await apiClient.post<any>(`/api/public/nrms/rooming-lists/${encodeURIComponent(token)}`, {
        submitterName: submitterName.trim(),
        submitterEmail: submitterEmailValue || null,
        rows: payload.map((draft) => ({
          blockRoomId: draft.blockRoomId === "" ? null : Number(draft.blockRoomId),
          fullName: draft.fullName.trim(),
          phone: draft.phone.trim(),
          email: draft.email.trim() || null,
          nationality: draft.nationality.trim(),
          adults: draft.adults,
          children: draft.children,
          sharingWith: draft.sharingWith.trim() || null,
          notes: draft.notes.trim() || null,
        })),
      });
      const next: PublicList = response.data?.roomingList;
      if (next) {
        setList(next);
        seed(next);
      }
      setServerIssues({});
      setSaved(true);
      setTouched(false);
      if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error: any) {
      const data = error?.response?.data;
      const rowIssues: Array<{ rowIndex: number; field: string; message: string }> = Array.isArray(data?.rowIssues) ? data.rowIssues : [];
      const formIssues: Array<{ field: string; message: string }> = Array.isArray(data?.formIssues) ? data.formIssues : [];

      if (rowIssues.length) {
        const mapped: Record<string, FieldIssues> = {};
        for (const issue of rowIssues) {
          const draft = payload[issue.rowIndex];
          if (!draft) continue;
          mapped[draft.key] = { ...(mapped[draft.key] ?? {}), [issue.field]: issue.message };
        }
        setServerIssues(mapped);
        revealFirstProblem(Object.keys(mapped));
      }
      const submitterProblem = formIssues.find((issue) => issue.field === "submitterName" || issue.field === "submitterEmail");
      if (submitterProblem) setSubmitterIssue({ field: submitterProblem.field as "submitterName" | "submitterEmail", message: submitterProblem.message });

      setSaveError(data?.error || "The list could not be sent. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#f6f7f8]">
      <PortalHeader propertyTitle={list?.property} />

      {loading ? (
        <main className="flex flex-1 items-center justify-center px-4">
          <span className="flex items-center gap-3 text-sm font-semibold text-neutral-500">
            <Loader2 className="h-5 w-5 animate-spin text-emerald-700" /> Loading the rooming list
          </span>
        </main>
      ) : loadError || !list ? (
        <main className="flex-1 px-4 py-12">
          <section className="mx-auto max-w-md rounded-2xl border border-solid border-neutral-200 bg-white p-7 text-center shadow-sm">
            <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
              <AlertTriangle className="h-5 w-5" />
            </span>
            <h1 className="m-0 text-lg font-bold tracking-tight text-neutral-950">This link is not open</h1>
            <p className="m-0 mt-2 text-sm leading-6 text-neutral-500">{loadError}</p>
          </section>
        </main>
      ) : (
        <main className="flex-1 px-4 py-6 sm:py-9">
          <div className="mx-auto flex max-w-3xl flex-col gap-5">
            {/* Stay summary. The property name is already in the header, so this
                card leads with the party it belongs to instead of repeating it. */}
            <section className="overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_14px_36px_-20px_rgba(15,23,42,0.16)]">
              <div className="relative overflow-hidden border-0 border-b border-solid border-neutral-100 bg-[linear-gradient(115deg,#064e3b_0%,#065f46_55%,#0f766e_100%)] px-5 py-6 sm:px-7 sm:py-7">
                <span className="pointer-events-none absolute -right-12 -top-20 h-52 w-52 rounded-full border border-solid border-white/10 bg-white/[0.04]" aria-hidden="true" />
                <span className="pointer-events-none absolute -bottom-24 -left-10 h-44 w-44 rounded-full border border-solid border-white/[0.07] bg-white/[0.03]" aria-hidden="true" />
                <p className="m-0 text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-200/90">Rooming list</p>
                <h1 className="mb-0 mt-2 text-2xl font-bold tracking-tight text-white sm:text-[26px]">{list.block.name}</h1>
                <p className="m-0 mt-2.5 text-sm font-medium text-emerald-50/85">
                  {fmtDate(list.block.checkIn)} to {fmtDate(list.block.checkOut)} &middot; {list.block.nights} {list.block.nights === 1 ? "night" : "nights"} at {list.property}
                </p>
                <div className="mt-5 flex flex-wrap gap-2">
                  <HeroChip icon={<BedDouble className="h-3.5 w-3.5" />} label={`${roomsBooked} ${roomsBooked === 1 ? "room" : "rooms"} booked`} />
                  <HeroChip icon={<CalendarClock className="h-3.5 w-3.5" />} label={`Names by ${fmtShortDate(list.block.namesDueBy)}`} />
                  <HeroChip icon={<Users className="h-3.5 w-3.5" />} label={`${namedCount} of ${roomsBooked} named`} />
                </div>
              </div>

              <div className="px-5 py-5 sm:px-7">
                <Progress value={namedCount} total={roomsBooked} />
                <div className="mt-4 flex flex-wrap gap-2">
                  {list.roomTypes.map((roomType) => (
                    <span
                      key={roomType.blockRoomId}
                      className="inline-flex items-center gap-2 rounded-lg border border-solid border-neutral-200 bg-neutral-50 px-3 py-2 text-xs font-bold text-neutral-800"
                    >
                      {roomType.roomTypeName}
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums ${roomType.remaining === 0 ? "bg-emerald-100 text-emerald-800" : "bg-white text-neutral-500"}`}>
                        {roomType.remaining === 0 ? "all named" : `${roomType.remaining} to name`}
                      </span>
                    </span>
                  ))}
                </div>
                {list.instructions && (
                  <div className="mt-4 rounded-xl border border-solid border-emerald-200 bg-emerald-50/60 px-4 py-3">
                    <p className="m-0 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-700">From the property</p>
                    <p className="m-0 mt-1.5 whitespace-pre-line text-xs leading-5 text-emerald-900">{list.instructions}</p>
                  </div>
                )}
              </div>
            </section>

            {readOnly && (
              <StatusBanner tone="emerald" icon={<CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />} title="The property has confirmed this list">
                Every name below is booked. Contact the property directly to change anything now.
              </StatusBanner>
            )}

            {!readOnly && list.status === "RETURNED" && list.deskNotes && (
              <StatusBanner tone="amber" icon={<AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />} title="The property sent this list back">
                <span className="whitespace-pre-line">{list.deskNotes}</span>
              </StatusBanner>
            )}

            {!readOnly && saved && (
              <StatusBanner tone="emerald" icon={<CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />} title="Sent to the property">
                The front desk will check the names and confirm them. You can come back to this link and send changes until they do.
              </StatusBanner>
            )}

            {lockedRows.length > 0 && (
              <section className="rounded-2xl border border-solid border-neutral-200 bg-white p-5 shadow-sm sm:p-6">
                <div className="mb-3 flex items-center gap-2">
                  <Lock className="h-3.5 w-3.5 text-emerald-700" />
                  <p className="m-0 text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-400">Accepted by the property</p>
                </div>
                <div className="space-y-2">
                  {lockedRows.map((row) => (
                    <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-solid border-emerald-200 bg-emerald-50/70 px-4 py-3">
                      <span className="inline-flex items-center gap-2 text-sm font-bold text-emerald-950">
                        <Check className="h-3.5 w-3.5 text-emerald-700" /> {row.fullName}
                      </span>
                      <span className="text-[11px] font-semibold text-emerald-800">
                        {row.adults} {row.adults === 1 ? "adult" : "adults"}{row.children > 0 ? `, ${row.children} ${row.children === 1 ? "child" : "children"}` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {!readOnly && (
              <>
                <section className="rounded-2xl border border-solid border-neutral-200 bg-white p-5 shadow-sm sm:p-6">
                  <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-0 border-b border-solid border-neutral-100 pb-4">
                    <div className="min-w-0">
                      <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">Your guests</p>
                      <h2 className="mb-0 mt-1.5 text-lg font-bold tracking-tight text-neutral-950">Who is staying</h2>
                      <p className="m-0 mt-1 text-xs leading-5 text-neutral-500">Full name, phone and nationality are needed for every guest. The rest helps the desk but can wait.</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-neutral-100 px-3 py-1.5 text-[11px] font-bold tabular-nums text-neutral-600">
                      {completeDrafts.length} of {drafts.length} ready
                    </span>
                  </div>

                  <div className="space-y-3.5">
                    {drafts.map((draft, index) => {
                      const started = draftStarted(draft);
                      const complete = draftComplete(draft);
                      const fromServer = serverIssues[draft.key] ?? {};
                      const hasServerIssue = Object.keys(fromServer).length > 0;
                      // Local rules only shout once the guest has been sent for;
                      // anything the API rejected shows immediately.
                      const shown: FieldIssues = { ...(touched && started ? draftIssues(draft) : {}), ...fromServer };
                      const showIssues = Object.keys(shown).length > 0;
                      return (
                        <article
                          key={draft.key}
                          id={`guest-${draft.key}`}
                          className={`overflow-hidden rounded-xl border border-solid transition ${showIssues ? "border-amber-300 bg-amber-50/30" : complete && !hasServerIssue ? "border-emerald-200 bg-white" : "border-neutral-200 bg-white"}`}
                        >
                          <div className={`flex items-center justify-between gap-3 border-0 border-b border-solid px-4 py-2.5 ${showIssues ? "border-amber-200 bg-amber-50/60" : complete ? "border-emerald-100 bg-emerald-50/50" : "border-neutral-100 bg-neutral-50"}`}>
                            <span className="inline-flex items-center gap-2.5 min-w-0">
                              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-bold tabular-nums ${complete ? "bg-emerald-700 text-white" : "bg-white text-neutral-500 shadow-sm"}`}>
                                {complete ? <Check className="h-3 w-3" /> : String(index + 1).padStart(2, "0")}
                              </span>
                              <span className="truncate text-xs font-bold text-neutral-700">
                                {draft.fullName.trim() || `Guest ${index + 1}`}
                              </span>
                            </span>
                            <button
                              type="button"
                              aria-label={`Remove guest ${index + 1}`}
                              onClick={() => setDrafts((current) => (current.length === 1 ? [emptyDraft()] : current.filter((_, position) => position !== index)))}
                              className="inline-flex h-7 w-7 shrink-0 cursor-pointer appearance-none items-center justify-center rounded-md border-0 bg-transparent p-0 text-neutral-400 transition hover:bg-red-50 hover:text-red-600"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>

                          <div className="p-4">
                            {draft.rejectionReason && (
                              <p className="m-0 mb-3.5 rounded-lg border border-solid border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold leading-4 text-amber-900">
                                Sent back: {draft.rejectionReason}
                              </p>
                            )}
                            <div className="grid gap-3.5 sm:grid-cols-2">
                              <TextField
                                label="Full name"
                                required
                                error={shown.fullName}
                                value={draft.fullName}
                                onValueChange={(value) => setDraft(index, { fullName: value })}
                                placeholder="As written in the passport"
                              />
                              <TextField
                                label="Phone"
                                required
                                error={shown.phone}
                                value={draft.phone}
                                onValueChange={(value) => setDraft(index, { phone: value })}
                                placeholder="+255..."
                              />
                              <TextField
                                label="Nationality"
                                required
                                error={shown.nationality}
                                value={draft.nationality}
                                onValueChange={(value) => setDraft(index, { nationality: value })}
                                placeholder="e.g. Tanzanian"
                              />
                              <label className="block">
                                <span className={labelCls}>Room</span>
                                <select
                                  className={selectCls}
                                  value={draft.blockRoomId}
                                  onChange={(event) => setDraft(index, { blockRoomId: event.target.value ? Number(event.target.value) : "" })}
                                >
                                  <option value="">Let the property decide</option>
                                  {list.roomTypes.map((roomType) => (
                                    <option key={roomType.blockRoomId} value={roomType.blockRoomId}>{roomType.roomTypeName}</option>
                                  ))}
                                </select>
                              </label>
                              <TextField
                                label="Email"
                                optional
                                error={shown.email}
                                value={draft.email}
                                onValueChange={(value) => setDraft(index, { email: value })}
                                placeholder="guest@example.com"
                              />
                              <TextField
                                label="Sharing with"
                                optional
                                value={draft.sharingWith}
                                onValueChange={(value) => setDraft(index, { sharingWith: value })}
                                placeholder="Another guest on this list"
                              />
                              <div className="grid grid-cols-2 gap-3.5">
                                <label className="block">
                                  <span className={labelCls}>Adults</span>
                                  <input type="number" min={1} max={20} className={`${fieldCls} tabular-nums`} value={draft.adults} onChange={(event) => setDraft(index, { adults: Math.max(1, Math.min(20, Number(event.target.value || 1))) })} />
                                </label>
                                <label className="block">
                                  <span className={labelCls}>Children</span>
                                  <input type="number" min={0} max={20} className={`${fieldCls} tabular-nums`} value={draft.children} onChange={(event) => setDraft(index, { children: Math.max(0, Math.min(20, Number(event.target.value || 0))) })} />
                                </label>
                              </div>
                              <TextField
                                label="Note for the desk"
                                optional
                                value={draft.notes}
                                onValueChange={(value) => setDraft(index, { notes: value })}
                                placeholder="Late arrival, dietary needs, access"
                              />
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    onClick={() => setDrafts((current) => [...current, emptyDraft()])}
                    className="mt-4 inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-neutral-300 bg-white px-4 py-3 text-xs font-bold text-neutral-600 transition hover:border-emerald-400 hover:bg-emerald-50/60 hover:text-emerald-800"
                  >
                    <Plus className="h-4 w-4" /> Add another guest
                  </button>
                </section>

                <section className="rounded-2xl border border-solid border-neutral-200 bg-white p-5 shadow-sm sm:p-6">
                  <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">Sending this list</p>
                  <h2 className="mb-0 mt-1.5 text-lg font-bold tracking-tight text-neutral-950">Who should the desk call back</h2>
                  <div className="mt-4 grid gap-3.5 sm:grid-cols-2">
                    <TextField
                      label="Your name"
                      required
                      error={submitterIssue?.field === "submitterName" ? submitterIssue.message : undefined}
                      value={submitterName}
                      onValueChange={(value) => { setSubmitterName(value); setSubmitterIssue(null); }}
                      placeholder="Agent or group leader"
                    />
                    <TextField
                      label="Your email"
                      optional
                      error={submitterIssue?.field === "submitterEmail" ? submitterIssue.message : undefined}
                      value={submitterEmail}
                      onValueChange={(value) => { setSubmitterEmail(value); setSubmitterIssue(null); }}
                      placeholder="bookings@agency.co.tz"
                    />
                  </div>

                  {saveError && (
                    <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-solid border-red-200 bg-red-50 px-4 py-3">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                      <div className="min-w-0">
                        <p className="m-0 text-sm font-semibold text-red-700">{saveError}</p>
                        {problemGuests.length > 0 && (
                          <button
                            type="button"
                            onClick={() => revealFirstProblem(problemGuests)}
                            className="mt-1.5 cursor-pointer appearance-none rounded-md border-0 bg-transparent p-0 text-[11px] font-bold text-red-700 underline transition hover:text-red-800"
                          >
                            Go to the first guest that needs fixing
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-0 border-t border-solid border-neutral-100 pt-5">
                    <p className="m-0 flex max-w-sm items-start gap-2 text-[11px] leading-5 text-neutral-500">
                      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                      Sending this list does not book anything by itself. The front desk checks the names and confirms them, and this link stays open until they do.
                    </p>
                    <button
                      type="button"
                      onClick={() => void submit()}
                      disabled={saving}
                      className="inline-flex shrink-0 cursor-pointer appearance-none items-center gap-2 rounded-xl border-0 bg-emerald-700 px-6 py-3.5 text-sm font-bold text-white shadow-[0_6px_16px_-8px_rgba(4,120,87,0.8)] transition hover:bg-emerald-800 disabled:opacity-50"
                    >
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      {list.status === "RETURNED" ? "Send the fixed list" : "Send to the property"}
                    </button>
                  </div>
                </section>
              </>
            )}
          </div>
        </main>
      )}

      <PortalFooter />
    </div>
  );
}

function RequiredMark() {
  return <span className="text-red-500" aria-hidden="true">*</span>;
}

/** One input plus its own error line, so a problem is shown against the field that caused it. */
function TextField({
  label,
  value,
  onValueChange,
  placeholder,
  required,
  optional,
  error,
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  optional?: boolean;
  error?: string;
}) {
  return (
    <label className="block">
      <span className={labelCls}>
        {label}
        {required && <RequiredMark />}
        {optional && <span className="font-normal text-neutral-400">optional</span>}
      </span>
      <input
        className={`${fieldCls} ${error ? "border-red-400 focus:border-red-500 focus:ring-red-500/10" : ""}`}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
      />
      {error && (
        <span className="mt-1.5 flex items-center gap-1 text-[11px] font-semibold text-red-600">
          <AlertTriangle className="h-3 w-3 shrink-0" /> {error}
        </span>
      )}
    </label>
  );
}

function HeroChip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-solid border-white/15 bg-white/10 px-2.5 py-1.5 text-[11px] font-bold text-white backdrop-blur-sm">
      {icon} {label}
    </span>
  );
}

/** Named against booked, the one number that says how far the list has to go. */
function Progress({ value, total }: { value: number; total: number }) {
  const percent = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-neutral-400">Names collected</span>
        <span className="text-[11px] font-bold tabular-nums text-neutral-600">{value} of {total}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-200">
        <div
          className="h-full rounded-full bg-[linear-gradient(90deg,#047857_0%,#0d9488_100%)] transition-all duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function StatusBanner({
  tone,
  icon,
  title,
  children,
}: {
  tone: "emerald" | "amber";
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  const cls = tone === "emerald" ? "border-emerald-200 bg-emerald-50" : "border-amber-300 bg-amber-50";
  const titleCls = tone === "emerald" ? "text-emerald-950" : "text-amber-950";
  const bodyCls = tone === "emerald" ? "text-emerald-900" : "text-amber-900";
  return (
    <div className={`flex items-start gap-3 rounded-2xl border border-solid p-4 sm:p-5 ${cls}`}>
      {icon}
      <div className="min-w-0">
        <p className={`m-0 text-sm font-bold ${titleCls}`}>{title}</p>
        <p className={`m-0 mt-1 text-xs leading-5 ${bodyCls}`}>{children}</p>
      </div>
    </div>
  );
}

/** Portal chrome for a bearer-link page: identifies the property without pulling in the marketing header. */
function PortalHeader({ propertyTitle }: { propertyTitle?: string }) {
  return (
    <header className="sticky top-0 z-30 border-0 border-b border-solid border-neutral-200 bg-white/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-solid border-neutral-200 bg-white shadow-sm">
            <Image src="/assets/NoLS2025-04.png" alt="NoLSAF" width={28} height={28} className="h-6 w-6 object-contain" />
          </span>
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-sm font-bold tracking-tight text-neutral-950">{propertyTitle || "Rooming list"}</span>
            <span className="block text-[10px] font-bold uppercase tracking-[0.16em] text-neutral-400">Guest name collection</span>
          </span>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-solid border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[10px] font-bold text-emerald-800">
          <ShieldCheck className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Private link</span>
        </span>
      </div>
    </header>
  );
}

function PortalFooter() {
  return (
    <footer className="border-0 border-t border-solid border-neutral-200 bg-white">
      <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-solid border-neutral-200 bg-white shadow-sm">
            <Image src="/assets/NoLS2025-04.png" alt="NoLSAF logo" width={30} height={30} className="h-7 w-7 object-contain" />
          </span>
          <span className="min-w-0">
            <span className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-neutral-400">Powered by</span>
              <strong className="text-sm font-bold tracking-tight text-neutral-950">NoLSAF</strong>
            </span>
            <span className="mt-0.5 block text-[11px] font-medium text-emerald-800">Rooms management for African hospitality</span>
          </span>
        </div>
        <div className="flex flex-col gap-2 sm:items-end">
          <p className="m-0 flex items-center gap-1.5 text-[11px] font-medium text-neutral-500">
            <Lock className="h-3.5 w-3.5 text-neutral-400" /> This link is private. Do not share it publicly.
          </p>
          <a
            href="https://nolsaf.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[11px] font-bold text-neutral-500 no-underline transition hover:text-emerald-800"
          >
            Visit nolsaf.com <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    </footer>
  );
}
