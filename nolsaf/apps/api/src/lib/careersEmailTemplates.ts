/**
 * Email templates for career and partnership application status updates.
 *
 * Built on the pro email shell (proEmail): logo header, bold headline, quiet
 * sections, shared footer. A button appears only where the reader must act
 * (set a password); info-only updates carry none.
 */
import { BRAND_TEAL, proButton, proDetailRows, proDivider, proEmail, proNoteCard } from "./emailBase.js";

export interface ApplicationEmailData {
  applicantName: string;
  jobTitle: string;
  jobDepartment?: string;
  status: "REVIEWING" | "SHORTLISTED" | "REJECTED" | "HIRED";
  adminNotes?: string | null;
  companyName?: string;
  supportEmail?: string;
  isPartnership?: boolean;
  portalUrl?: string;
  loginUrl?: string;
  username?: string;
  setupLink?: string;
  setupLinkExpiresHours?: number;
}

const AMBER = "#b54708";

/** Applicant-typed and admin-typed text is escaped before it enters the HTML. */
function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const p = (html: string, extra = "") => `<p style="margin:0 0 16px;${extra}">${html}</p>`;
const muted = (html: string) => p(html, "color:#5f6b69;font-size:14px;");
const heading = (text: string) =>
  `<div style="font-size:14px;font-weight:bold;color:#1a1a1a;margin:0 0 10px;">${text}</div>`;
const signOff = (team: string, closing = "Warm regards") =>
  `<p style="margin:22px 0 0;color:#1a1a1a;">${closing},<br><strong>${team}</strong></p>`;
const link = (url: string) =>
  `<a href="${esc(url)}" style="color:${BRAND_TEAL};text-decoration:none;font-weight:bold;">${esc(url)}</a>`;

function list(items: string[]): string {
  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 16px;">
      ${items
        .map(
          (item) => `
      <tr>
        <td style="width:18px;vertical-align:top;padding:3px 0;color:${BRAND_TEAL};font-weight:bold;">&#8226;</td>
        <td style="padding:3px 0;font-size:14px;color:#374151;line-height:1.65;">${item}</td>
      </tr>`,
        )
        .join("")}
    </table>`;
}

function notesBlock(adminNotes: string | null | undefined): string {
  if (!adminNotes || !String(adminNotes).trim()) return "";
  return `${proDivider()}${proNoteCard(AMBER, "A note from our team", esc(adminNotes).replace(/\n/g, "<br>"), "#fffaf3")}`;
}

/** Account access block for approval mails: what to log in with, the one button, the links. */
function accessBlock(input: {
  username?: string;
  setupLink?: string;
  setupLinkExpiresHours?: number;
  loginUrl?: string;
  portalUrl?: string;
  supportEmail: string;
  setupLabel: string;
}): string {
  const rows: Array<[string, string]> = [];
  if (input.username) rows.push(["Login email", esc(input.username)]);
  if (input.loginUrl) rows.push(["Sign in page", link(input.loginUrl)]);
  if (input.portalUrl) rows.push(["Workspace", link(input.portalUrl)]);
  const button = input.setupLink
    ? proButton(input.setupLink, input.setupLabel)
    : proButton(`mailto:${input.supportEmail}`, "Request a password setup link");
  const expiry = input.setupLink
    ? `<p style="margin:10px 0 0;font-size:13px;color:#5f6b69;">${input.setupLinkExpiresHours ? `This link works once and expires in ${input.setupLinkExpiresHours} hours. ` : "This link works once. "}NoLSAF will never ask you for your password by email, phone or WhatsApp. If you did not apply to NoLSAF, ignore this email; nothing happens until the link is used.</p>`
    : "";
  return `
    ${rows.length ? proDetailRows("Your access", rows) : ""}
    <div style="height:18px;font-size:0;line-height:0;">&nbsp;</div>
    ${button}
    ${expiry}`;
}

export function getApplicationEmailSubject(
  status: ApplicationEmailData["status"],
  jobTitle: string,
  isPartnership = false,
): string {
  if (isPartnership) {
    switch (status) {
      case "REVIEWING":
        return `Partnership application received: ${jobTitle}`;
      case "SHORTLISTED":
        return `Partnership verification in progress: ${jobTitle}`;
      case "REJECTED":
        return `Update on your NoLSAF partnership application`;
      case "HIRED":
        return `Your NoLSAF partner workspace is approved`;
      default:
        return `NoLSAF partnership application update`;
    }
  }

  switch (status) {
    case "REVIEWING":
      return `Application received: ${jobTitle} at NoLSAF`;
    case "SHORTLISTED":
      return `You've been shortlisted: ${jobTitle} at NoLSAF`;
    case "REJECTED":
      return `Update on your application: ${jobTitle} at NoLSAF`;
    case "HIRED":
      return `Congratulations, you've been hired: ${jobTitle} at NoLSAF`;
    default:
      return `Update on your application: ${jobTitle} at NoLSAF`;
  }
}

function generatePartnershipStatusEmail(data: ApplicationEmailData): string {
  const { status, adminNotes, supportEmail = "careers@nolsaf.com" } = data;
  const name = esc(data.applicantName);
  const title = esc(data.jobTitle);
  const team = "The NoLSAF Partnerships Team";
  const applied = proDetailRows("", [
    ["Application", title],
    ...(data.jobDepartment ? ([["Area", esc(data.jobDepartment)]] as Array<[string, string]>) : []),
  ]);

  let headline = "Your partnership application";
  let body = "";

  if (status === "REVIEWING") {
    headline = "Application received";
    body = `
      ${p(`Hello ${name},`)}
      ${p(`Thank you for applying to partner with NoLSAF. Your company profile has been received and is now in partner verification.`)}
      ${applied}
      ${proDivider()}
      ${heading("What our team reviews")}
      ${list([
        "Company identity, contact details and operating coverage.",
        "Permitted parks, tour sites, service categories, languages and team capacity.",
        "Tourism permits, business documents, and fleet or guide details where they apply.",
        "How your services connect to NoLSAF bookings, timelines, support and traveller records.",
      ])}
      ${muted("No action is needed right now. If we need a permit, a clarification or an updated detail, the partnerships team will contact you directly.")}
      ${signOff(team)}`;
  }

  if (status === "SHORTLISTED") {
    headline = "Your application is in verification";
    body = `
      ${p(`Good news, ${name}.`)}
      ${p(`Your partnership application has moved into verification. Your profile fits the NoLSAF partner network; final approval waits on document and service checks.`)}
      ${applied}
      ${proDivider()}
      ${heading("Please keep these ready")}
      ${list([
        "Business registration, TIN, licences, and tourism or park permits.",
        "Operating regions, permitted tour sites and the services your team delivers.",
        "Fleet, guide, language or safety information where it applies.",
      ])}
      ${muted("A NoLSAF team member may contact you to confirm details before your partner workspace is activated.")}
      ${signOff(team)}`;
  }

  if (status === "REJECTED") {
    headline = "An update on your application";
    body = `
      ${p(`Hello ${name},`)}
      ${p(`Thank you for applying to join NoLSAF as a partner. We reviewed your company profile, service scope and submitted details carefully.`)}
      ${applied}
      <div style="height:16px;font-size:0;line-height:0;">&nbsp;</div>
      ${p(`At this time we are not able to approve this application. This can be due to missing documents, service coverage, permit readiness, or fit with current NoLSAF operating requirements.`)}
      ${muted("You are welcome to apply again once your company information, permits or operating details are ready. If our team left a note below, start there.")}
      ${signOff(team, "Kind regards")}`;
  }

  if (status === "HIRED") {
    headline = "Welcome to the NoLSAF partner network";
    body = `
      ${p(`Congratulations, ${name}.`)}
      ${p(`Your partnership application has been approved and your NoLSAF partner workspace is active. Create your password, then sign in to finish your profile and onboarding checklist.`)}
      ${accessBlock({ ...data, supportEmail, setupLabel: "Create your password" })}
      ${proDivider()}
      ${heading("What your workspace is for")}
      ${list([
        "Company details, operating regions, permits, services, languages, fleet and team.",
        "Tour packages, permitted parks and sites, inclusions, prices and availability.",
        "Bookings, meetup checks, tour timelines, traveller support and delivery tracking.",
        "Traveller ratings, reports and payout records where they apply.",
      ])}
      ${heading("Documents to prepare")}
      ${list([
        "Business registration, TIN, business licence, and tourism or park permits.",
        "Fleet, guide, safety, insurance or service documents where they apply.",
        "A signed partnership agreement or NDA if the NoLSAF team asks for one.",
      ])}
      ${muted(`For help, reply to this email or write to <a href="mailto:${esc(supportEmail)}" style="color:${BRAND_TEAL};text-decoration:none;font-weight:bold;">${esc(supportEmail)}</a>.`)}
      ${signOff(team)}`;
  }

  return proEmail(headline, `${body}${notesBlock(adminNotes)}`);
}

/** A fresh password setup link, sent when an operator's first one expired or was lost. */
export function generateOperatorSetupLinkEmail(data: {
  name: string;
  setupLink: string;
  setupLinkExpiresHours: number;
  username?: string;
  loginUrl?: string;
  portalUrl?: string;
  supportEmail?: string;
}): { subject: string; html: string } {
  const supportEmail = data.supportEmail || "partners@nolsaf.com";
  const body = `
    ${p(`Hello ${esc(data.name)},`)}
    ${p("Here is a new link to create the password for your NoLSAF operator workspace. Any earlier link no longer works.")}
    ${accessBlock({ ...data, supportEmail, setupLabel: "Create your password" })}
    ${muted(`Questions? Reply to this email or write to <a href="mailto:${esc(supportEmail)}" style="color:${BRAND_TEAL};text-decoration:none;font-weight:bold;">${esc(supportEmail)}</a>.`)}
    ${signOff("The NoLSAF Partnerships Team")}`;
  return { subject: "Your new NoLSAF password setup link", html: proEmail("Create your password", body) };
}

export function generateApplicationStatusEmail(data: ApplicationEmailData): string {
  if (data.isPartnership) return generatePartnershipStatusEmail(data);

  const { status, adminNotes, supportEmail = "careers@nolsaf.com" } = data;
  const name = esc(data.applicantName);
  const title = esc(data.jobTitle);
  const team = "The NoLSAF Careers Team";
  const role = proDetailRows("", [
    ["Role", title],
    ...(data.jobDepartment ? ([["Department", esc(data.jobDepartment)]] as Array<[string, string]>) : []),
  ]);

  let headline = "Your application";
  let body = "";

  if (status === "REVIEWING") {
    headline = "Application received";
    body = `
      ${p(`Dear ${name},`)}
      ${p(`Thank you for applying to NoLSAF. Your application has been received and our team is reviewing it.`)}
      ${role}
      ${proDivider()}
      ${heading("What happens next")}
      ${p(`We review every application against the role requirements. This usually takes <strong>3 to 5 business days</strong>, and we will email you at each stage.`, "font-size:14px;")}
      ${muted("You do not need to do anything right now. If we need more from you, we will contact you directly.")}
      ${signOff(team)}`;
  }

  if (status === "SHORTLISTED") {
    headline = "You have been shortlisted";
    body = `
      ${p(`Congratulations, ${name}.`)}
      ${p(`Your application has passed our first review. A member of our team will contact you with the next step.`)}
      ${role}
      <div style="height:16px;font-size:0;line-height:0;">&nbsp;</div>
      ${muted("The next step may be a phone screening, an interview or a short assessment. We will share the details before anything is scheduled.")}
      ${signOff(team)}`;
  }

  if (status === "REJECTED") {
    headline = "An update on your application";
    body = `
      ${p(`Dear ${name},`)}
      ${p(`Thank you for your interest in NoLSAF and for the time you put into your application.`)}
      ${role}
      <div style="height:16px;font-size:0;line-height:0;">&nbsp;</div>
      ${p(`After reviewing all applications, we have decided to move forward with candidates whose experience more closely matches this role at this time.`)}
      ${muted("You are welcome to apply for future roles that match your profile.")}
      ${signOff(team, "Kind regards")}`;
  }

  if (status === "HIRED") {
    headline = "Welcome to NoLSAF";
    body = `
      ${p(`Welcome, ${name}.`)}
      ${p(`We are pleased to offer you this role at NoLSAF. Your account has been created so you can complete onboarding and reach your dashboard.`)}
      ${role}
      ${accessBlock({ ...data, supportEmail, setupLabel: "Set your password" })}
      ${proDivider()}
      ${heading("Documents to upload during onboarding")}
      ${list([
        "Academic certificates or professional documents the team asks for.",
        "A signed NDA or agreement if requested.",
        "Anything else noted in your onboarding messages.",
      ])}
      ${muted(`Our team is here to help. Reply to this email or write to <a href="mailto:${esc(supportEmail)}" style="color:${BRAND_TEAL};text-decoration:none;font-weight:bold;">${esc(supportEmail)}</a>.`)}
      ${signOff(team)}`;
  }

  return proEmail(headline, `${body}${notesBlock(adminNotes)}`);
}
