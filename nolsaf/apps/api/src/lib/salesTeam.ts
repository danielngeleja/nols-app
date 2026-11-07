/** Sales team lookups shared by the partner, team-lead and admin routes. */

/** The active team this partner leads, or null. */
export async function ledTeamOf(db: any, partnerId: number): Promise<{ id: number; name: string; region: string | null } | null> {
  const team = await db.salesTeam.findUnique({ where: { leadPartnerId: partnerId }, select: { id: true, name: true, region: true, status: true } });
  return team && team.status === "ACTIVE" ? { id: team.id, name: team.name, region: team.region } : null;
}

/** Partner ids currently in a team (the lead is not a member). */
export async function teamMemberIds(db: any, teamId: number): Promise<number[]> {
  const rows = await db.salesTeamMember.findMany({ where: { teamId, activeKey: { not: null } }, select: { salesPartnerId: true } });
  return rows.map((row: any) => row.salesPartnerId);
}

/** The team a partner belongs to, as a member or as its lead. */
export async function teamIdOf(db: any, partnerId: number): Promise<number | null> {
  const led = await ledTeamOf(db, partnerId);
  if (led) return led.id;
  const membership = await db.salesTeamMember.findUnique({ where: { activeKey: partnerId }, select: { teamId: true } });
  return membership?.teamId ?? null;
}

/** The team lead's user id for a partner's team, for alerts. */
export async function teamLeadUserFor(db: any, partnerId: number): Promise<number | null> {
  const membership = await db.salesTeamMember.findUnique({
    where: { activeKey: partnerId },
    select: { team: { select: { status: true, lead: { select: { userId: true } } } } },
  });
  return membership?.team?.status === "ACTIVE" ? membership.team.lead?.userId ?? null : null;
}
