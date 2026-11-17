/**
 * Driver lifecycle emails (pro email shell): application approved, not
 * approved, access revoked, suspension lifted. Driver and admin text is
 * escaped. Dates are Tanzania time.
 */
import { BRAND_TEAL, proButton, proDetailRows, proDivider, proEmail, proNoteCard, proReferenceCard } from "./emailBase.js";
import { AMBER, RED, bullets, eatDate, esc, escLines, gap, mailLink, mutedPara, para, sectionTitle, signOff } from "./proEmailParts.js";

type DriverMailBase = { firstName: string; driverName: string; email: string; at: Date };

export function getDriverApprovedEmail(data: DriverMailBase & { loginUrl: string }) {
  const body = `
    ${para(`Congratulations, ${esc(data.firstName)}.`)}
    ${para(`Your driver application is <strong style="color:${BRAND_TEAL};">approved</strong>. Your documents are verified and your account is active, so you can start taking trips.`)}
    ${proDetailRows("", [
      ["Login email", esc(data.email)],
      ["Approved on", esc(eatDate(data.at))],
    ])}
    ${gap(22)}
    ${proButton(data.loginUrl, "Sign in and start driving")}
    ${proDivider()}
    ${sectionTitle("Get started")}
    ${bullets([
      "Sign in with the email and password you registered with.",
      "Finish your driver profile: add your photo and the zones you prefer.",
      "Go online and accept your first trip.",
    ])}
    ${mutedPara(`Questions? Write to ${mailLink("support@nolsaf.com")}.`)}
    ${signOff("The NoLSAF Team", "Welcome aboard")}
  `;
  return {
    subject: `Welcome aboard, ${data.firstName}: your NoLSAF driver account is approved`,
    html: proEmail("Your driver account is approved", body),
  };
}

export function getDriverRejectedEmail(data: DriverMailBase & { reason?: string | null }) {
  const body = `
    ${para(`Dear ${esc(data.firstName)},`)}
    ${para("We reviewed your driver application and cannot approve it yet. This is not a suspension: your application just needs a correction or clarification before it can be accepted.")}
    ${proNoteCard(AMBER, "What to correct", data.reason ? escLines(data.reason) : "Our team did not add a specific reason. Contact support and we will tell you what is missing.", "#fffaf3")}
    ${gap()}
    ${proDetailRows("", [
      ["Applicant", esc(data.driverName)],
      ["Reviewed on", esc(eatDate(data.at))],
    ])}
    ${proDivider()}
    ${sectionTitle("What to do next")}
    ${bullets([
      "Correct the information or documents named above.",
      `Write to ${mailLink("support@nolsaf.com")} if anything is unclear.`,
      "Send your application again once everything is complete and accurate.",
    ])}
    ${signOff()}
  `;
  return {
    subject: "Update needed: your NoLSAF driver application",
    html: proEmail("Your application needs a correction", body),
  };
}

export function getDriverRevokedEmail(data: DriverMailBase & { reason?: string | null; caseRef: string }) {
  const body = `
    ${para(`Dear ${esc(data.firstName)},`)}
    ${para(`Your access to the NoLSAF driver app has been <strong style="color:${RED};">revoked</strong> by an administrator. You can no longer sign in as a driver.`)}
    ${proReferenceCard("Reference number", esc(data.caseRef), "Quote this reference in every message about this decision.", RED, "#fff6f5")}
    ${gap()}
    ${proDetailRows("", [
      ["Driver", esc(data.driverName)],
      ["Reason", data.reason ? escLines(data.reason) : "Not specified"],
      ["Effective", esc(eatDate(data.at))],
    ])}
    ${gap()}
    ${proNoteCard(BRAND_TEAL, "Payouts already due", "Any unpaid payout you had earned before this date is still reviewed and paid through our normal payout process.")}
    ${proDivider()}
    ${mutedPara(`If you believe this is a mistake or want to appeal, write to ${mailLink("support@nolsaf.com")} with your registered email, the reference number and a short description.`)}
    ${signOff()}
  `;
  return {
    subject: `Important: your NoLSAF driver access is revoked (Ref: ${data.caseRef})`,
    html: proEmail("Your driver access is revoked", body),
  };
}

export function getDriverRestoredEmail(data: DriverMailBase & { reason?: string | null; loginUrl: string }) {
  const body = `
    ${para(`Dear ${esc(data.firstName)},`)}
    ${para(`Your driver account suspension has been <strong style="color:${BRAND_TEAL};">lifted</strong>. You can sign in again and continue driving.`)}
    ${proDetailRows("", [
      ["Driver", esc(data.driverName)],
      ["Reason", data.reason ? escLines(data.reason) : "Administrative review completed"],
      ["Effective", esc(eatDate(data.at))],
    ])}
    ${gap(22)}
    ${proButton(data.loginUrl, "Sign in again")}
    ${proDivider()}
    ${sectionTitle("Before your next trip")}
    ${bullets([
      "Check any pending trips, payouts or notices in your dashboard.",
      "Keep operating in line with NoLSAF driver policies.",
    ])}
    ${mutedPara(`Questions? Write to ${mailLink("support@nolsaf.com")}.`)}
    ${signOff("The NoLSAF Team", "Welcome back")}
  `;
  return {
    subject: `${data.firstName}, your NoLSAF driver account is active again`,
    html: proEmail("Your driver account is active again", body),
  };
}
