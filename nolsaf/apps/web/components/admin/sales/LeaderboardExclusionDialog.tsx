"use client";

/**
 * Exclude a partner from a month's leaderboard, or put them back, with a
 * reason. Says plainly what it does: off the board and out of badges and Top
 * team, points kept, and (when excluding) a fraud signal on their next
 * withdrawal so a person checks it.
 */
import { RotateCcw, ShieldOff } from "lucide-react";
import AdminReasonDialog from "./AdminReasonDialog";

export type ExclusionTarget = {
  name: string;
  agentCode: string;
  region: string | null;
  rank: number | null;
  points: number;
  excluded: boolean;
  excludedReason: string | null;
};

export default function LeaderboardExclusionDialog({
  target,
  monthLabel,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  target: ExclusionTarget;
  monthLabel: string;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const restoring = target.excluded;
  return (
    <AdminReasonDialog
      icon={restoring ? RotateCcw : ShieldOff}
      tone={restoring ? "safe" : "danger"}
      title={restoring ? "Put back on the board" : "Exclude from the board"}
      subject={<>{target.name} · <span className="font-mono text-emerald-300">{target.agentCode}</span>{target.region ? ` · ${target.region}` : ""}</>}
      figures={[["Month", monthLabel], ["Rank now", target.rank ? `#${target.rank}` : "Not ranked"], ["Points", target.points.toLocaleString("en-US")]]}
      effects={restoring
        ? [
            "They appear on this month's board again with their points.",
            "Badges and Top team count them again.",
            "Their next withdrawal is no longer flagged for this. A pause already placed stays until cleared on their record.",
          ]
        : [
            "Off this month's board, badges and Top team. Their points stay recorded.",
            "They see only that they are not on this month's board, never your reason.",
            "Their next withdrawal is held for a person to check, and withdrawals pause until it is cleared.",
          ]}
      note={restoring && target.excludedReason ? <>Excluded because: <span className="font-medium text-neutral-800">{target.excludedReason}</span></> : undefined}
      chips={restoring
        ? ["Review cleared, no wrongdoing", "Flagged visits approved", "Excluded by mistake"]
        : ["Flagged visits under review", "Owner denied knowing the partner", "Possible self-dealing", "Duplicate or recycled leads"]}
      placeholder={restoring ? "What the review found" : "What you saw, and what is being checked"}
      confirmLabel={restoring ? "Put back on the board" : "Exclude this month"}
      busy={busy}
      error={error}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
