import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("operator partnership discovery is wired into the established Agent shell", async () => {
  const [shell, page] = await Promise.all([
    read("./components/AgentShell.tsx"),
    read("./app/(agent)/agent-portal/partners/page.tsx"),
  ]);
  assert.match(shell, /\/agent-portal\/partners/);
  assert.match(page, /\/api\/agent-portal\/partnerships\/discover/);
  assert.match(page, /\/api\/agent-portal\/partnerships\/requests/);
  assert.match(page, /No rates, rooms, contacts, or booking authority are granted/);
});

test("hotel partnership and booking queues remain distinct", async () => {
  const [layout, partnershipPage, bookingPage] = await Promise.all([
    read("./app/(owner)/owner/nrms/layout.tsx"),
    read("./app/(owner)/owner/nrms/agents/partnerships/page.tsx"),
    read("./app/(owner)/owner/nrms/agents/requests/page.tsx"),
  ]);
  assert.match(layout, /Partnership requests/);
  assert.match(layout, /Booking requests/);
  assert.match(layout, /aria-expanded=\{nestedOpen\}/);
  assert.match(layout, /nrms-travel-agent-navigation/);
  assert.match(partnershipPage, /\/api\/owner\/nrms\/agents\/property/);
  assert.match(partnershipPage, /\/api\/owner\/nrms\/agents\/\$\{link\.id\}\/\$\{action\}/);
  assert.doesNotMatch(partnershipPage, /\/agents\/requests\/\$\{id\}/);
  assert.match(bookingPage, /\/agents\/requests\/\$\{id\}\/\$\{action\}/);
});

test("OTA providers are controlled from a collapsible sidebar group", async () => {
  const [layout, channelsPage] = await Promise.all([
    read("./app/(owner)/owner/nrms/layout.tsx"),
    read("./app/(owner)/owner/nrms/channels/page.tsx"),
  ]);
  assert.match(layout, /nrms-ota-navigation/);
  assert.match(layout, /channels\?provider=EXPEDIA/);
  assert.match(layout, /channels\?provider=BOOKING_COM/);
  assert.match(layout, /channels\?provider=AIRBNB/);
  assert.match(channelsPage, /searchParams\.get\("provider"\)/);
  assert.doesNotMatch(channelsPage, /aria-label="OTA providers"/);
});

test("hotel control sections are controlled from the sidebar", async () => {
  const [layout, controlsPage] = await Promise.all([
    read("./app/(owner)/owner/nrms/layout.tsx"),
    read("./app/(owner)/owner/nrms/controls/page.tsx"),
  ]);
  assert.match(layout, /nrms-hotel-controls-navigation/);
  for (const section of ["rates", "readiness", "service", "guest", "portfolio", "growth"]) {
    assert.match(layout, new RegExp(`controls\\?section=${section}`));
  }
  assert.match(controlsPage, /searchParams\.get\("section"\)/);
  assert.doesNotMatch(controlsPage, /aria-label="Hotel controls"/);
});

test("finance sections are controlled from a role-scoped sidebar group", async () => {
  const [layout, financePage] = await Promise.all([
    read("./app/(owner)/owner/nrms/layout.tsx"),
    read("./app/(owner)/owner/nrms/finance/page.tsx"),
  ]);
  assert.match(layout, /nrms-finance-navigation/);
  for (const view of ["audit", "cashiers", "expenses", "ledger", "tax", "nbs"]) {
    assert.match(layout, new RegExp(`finance\\?view=${view}`));
  }
  assert.match(layout, /child\.roles\.includes\(accessRole\)/);
  assert.match(financePage, /searchParams\.get\("view"\)/);
  assert.match(financePage, /data\?\.accessRole === "FRONT_DESK"/);
  assert.doesNotMatch(financePage, /tabs\.filter/);
});

test("property outlets are selected from the role-scoped sidebar", async () => {
  const [layout, outletsPage] = await Promise.all([
    read("./app/(owner)/owner/nrms/layout.tsx"),
    read("./app/(owner)/owner/nrms/outlets/page.tsx"),
  ]);

  assert.match(layout, /nrms-outlet-navigation/);
  assert.match(layout, /outlets\?outlet=setup/);
  assert.match(layout, /sidebarOutlets\.map/);
  assert.match(layout, /nrms-outlets-updated/);
  assert.match(outletsPage, /searchParams\.get\("outlet"\)/);
  assert.match(outletsPage, /new CustomEvent\("nrms-outlets-updated"/);
  assert.doesNotMatch(outletsPage, /Property outlets/);
});

test("Admin has portfolio-wide partnership oversight and guarded controls", async () => {
  const [sidebar, directory, layout, page, api] = await Promise.all([
    read("./components/AdminSidebar.tsx"),
    read("./app/(admin)/admin/nrms/page.tsx"),
    read("./app/(admin)/admin/nrms/layout.tsx"),
    read("./app/(admin)/admin/nrms/partnerships/page.tsx"),
    read("../api/src/routes/admin.nrms.commercial.ts"),
  ]);

  assert.match(sidebar, /admin\/nrms\/partnerships/);
  assert.match(directory, /Partnerships/);
  assert.doesNotMatch(layout, /partnerships/);
  assert.match(page, /commercial\/partnerships/);
  assert.match(page, /commercial\/property\/\$\{selected\.property\.id\}\/agent-limit/);
  assert.match(page, /confirmSuspend/);
  assert.match(page, /confirmResume/);
  assert.match(page, /suspensionAuthority === "ADMIN"/);
  assert.match(page, /lifecycleReady/);
  assert.match(page, /No accommodation partnerships yet/);
  assert.match(page, /<table/);
  assert.match(page, /aria-label=\{`View \$\{displayName\(row\)\} partnership details`\}/);
  assert.match(page, /<Eye className="h-4 w-4"/);
  assert.match(page, /role="dialog"/);
  assert.match(page, /detailOpen/);
  assert.match(api, /router\.get\("\/partnerships"/);
  assert.match(api, /isPendingPartnershipLifecycleMigration/);
  assert.match(api, /lifecycleReady/);
  assert.match(api, /regionName: true/);
  assert.match(api, /router\.post\("\/partnerships\/:linkId\/suspend", requireNrmsFinanceApprover as RequestHandler, requireFinanceGrant as RequestHandler/);
  assert.match(api, /router\.post\("\/partnerships\/:linkId\/resume", requireNrmsFinanceApprover as RequestHandler, requireFinanceGrant as RequestHandler/);
  assert.match(api, /NRMS_PARTNERSHIP_SUSPEND/);
  assert.match(api, /NRMS_PARTNERSHIP_RESUME/);
  assert.match(api, /SEAT_CONSUMING_LINK_STATUSES/);
});
