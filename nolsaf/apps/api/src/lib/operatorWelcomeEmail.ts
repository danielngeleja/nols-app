// =============================================================================
// Sent once, when a tour operator creates their first password: what to do
// next to become bookable, how NoLSAF works, and the timelines NoLSAF commits
// to. It also stands in for the "password changed" security notice, so it ends
// with the time the password was created and what to do if it was not them.
//
// The steps carry no links: one button opens the workspace, where each step is.
//
// Numbers:
//   ADVANCE_* and BALANCE_DISPUTE_WINDOW_HOURS: lib/tourPayoutPolicy.ts
//   payout 3 to 30 minutes after a claim: the mobile money payout speed
// =============================================================================

import { BRAND_TEAL, proButton, proDetailRows, proDivider, proEmail, proNoteCard } from "./emailBase.js";
import { esc, eatDate, gap, mailLink, mutedPara, para, sectionTitle, signOff } from "./proEmailParts.js";
import {
  ADVANCE_BASE_PERCENT, ADVANCE_FULL_WINDOW_HOURS, ADVANCE_MAX_PERCENT, ADVANCE_OPENS_DAYS_BEFORE,
  BALANCE_DISPUTE_WINDOW_HOURS,
} from "./tourPayoutPolicy.js";

export type OperatorWelcomeEmailInput = {
  name: string;
  companyName?: string | null;
  origin: string;
  createdAt: Date;
  /** True when the agreement is still waiting for the operator's signature. */
  agreementToSign?: boolean;
  /** How fast a claimed payout reaches mobile money, in minutes. */
  payoutMinMinutes?: number;
  payoutMaxMinutes?: number;
  supportEmail?: string;
};

function stepList(steps: Array<{ title: string; text: string }>): string {
  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 8px;">
      ${steps.map((step, i) => `
      <tr>
        <td style="width:34px;vertical-align:top;padding:10px 0;">
          <div style="width:26px;height:26px;border-radius:7px;background:${BRAND_TEAL};color:#ffffff;font-size:13px;font-weight:bold;line-height:26px;text-align:center;">${i + 1}</div>
        </td>
        <td style="vertical-align:top;padding:10px 0;border-bottom:${i === steps.length - 1 ? "0" : "1px solid #eef1f1"};">
          <div style="font-size:15px;font-weight:bold;color:#1a1a1a;">${step.title}</div>
          <div style="font-size:14px;color:#4b5563;line-height:1.65;margin-top:3px;">${step.text}</div>
        </td>
      </tr>`).join("")}
    </table>`;
}

export function generateOperatorWelcomeEmail(input: OperatorWelcomeEmailInput): { subject: string; html: string } {
  const origin = String(input.origin || "https://www.nolsaf.com").replace(/\/+$/, "");
  const workspace = `${origin}/account/agent`;
  const support = input.supportEmail || "partners@nolsaf.com";
  const payoutMin = input.payoutMinMinutes ?? 3;
  const payoutMax = input.payoutMaxMinutes ?? 30;
  const company = input.companyName ? esc(input.companyName) : "your company";

  const steps = [
    {
      title: "Complete your company profile",
      text: `Company details, services, the areas you operate in, your logo and real photos. This is what travellers read before they choose ${company}, and NoLSAF reviews it before it goes public.`,
    },
    {
      title: "Upload your documents",
      text: "BRELA certificate, TIN, Tourism Licence, Business Licence and the representative's ID, as PDFs. Each one is checked by NoLSAF compliance; approved documents are what make you a verified operator.",
    },
    ...(input.agreementToSign
      ? [{
          title: "Sign your partnership agreement",
          text: "NoLSAF has already signed. Read it, including the commission and payout terms, then add your signature.",
        }]
      : []),
    {
      title: "Create packages travellers can book",
      text: "Price per person, group size, the day-by-day itinerary, what is included and what is not. A package goes on sale once it is complete and your profile is approved. Two or three strong packages beat ten thin ones.",
    },
    {
      title: "Add your mobile money payout account",
      text: "NoLSAF pays operators by mobile money only; bank transfers are not available for now. Add and verify your mobile money number so your first payment is never held up.",
    },
  ];

  const body = `
    ${para(`Hello ${esc(input.name)},`)}
    ${para(`Your password is set and your NoLSAF operator workspace is open. Here is the order that gets ${company} from an account to taking paid bookings, fastest.`)}
    ${gap(6)}
    ${sectionTitle("Your first steps")}
    ${stepList(steps)}
    ${gap(10)}
    ${proButton(workspace, "Open your workspace")}
    ${gap(24)}
    ${proNoteCard(
      BRAND_TEAL,
      "How NoLSAF works",
      `Travellers find your packages on NoLSAF, book and pay NoLSAF directly. Our commission is added on top of your package price and paid by the traveller, so <strong>you receive your full package price</strong>. There is no subscription and no listing fee. NoLSAF takes the payment and runs any cancellation case, and you see every booking, case and payout in your workspace.`,
    )}
    ${gap(18)}
    ${proDetailRows("Timelines NoLSAF commits to", [
      ["New paid booking", "You are told at once, in your workspace and by email"],
      ["Trip advance", `Opens ${ADVANCE_OPENS_DAYS_BEFORE} days before departure: ${ADVANCE_BASE_PERCENT}% of your share, up to ${ADVANCE_MAX_PERCENT}% with supplier receipts or inside the last ${ADVANCE_FULL_WINDOW_HOURS} hours (Silver operators and above)`],
      ["Trip balance", `Ready when the traveller confirms the trip, or automatically ${BALANCE_DISPUTE_WINDOW_HOURS} hours after it ends`],
      ["Payout", `${payoutMin} to ${payoutMax} minutes after each claim, to your mobile money account`],
    ])}
    ${gap(10)}
    ${mutedPara("Money before the trip, the rest soon after it, on fixed timelines you can plan around: that is how NoLSAF keeps operators funded. The full rules are in the Tour Operator Disbursement Policy in your workspace.")}
    ${proDivider()}
    ${mutedPara(`For your security: your password was created on ${esc(eatDate(input.createdAt, true))}. If that was not you, write to ${mailLink(support)} straight away. NoLSAF will never ask for your password by email, phone or WhatsApp.`)}
    ${signOff("The NoLSAF Partnerships Team")}`;

  return {
    subject: "Welcome to NoLSAF: your first steps as an operator",
    html: proEmail("Your operator workspace is ready", body),
  };
}
