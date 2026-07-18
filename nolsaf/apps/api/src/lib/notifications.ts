import { prisma } from "@nolsaf/prisma";

/**
 * Notify all admins (creates notification with userId=null, ownerId=null so it appears in admin notifications)
 */
export async function notifyAdmins(template: string, data: any) {
  try {
    const notificationTemplates: Record<string, { title: string; body: string }> = {
      careers_application_submitted: {
        title: "New Career Application",
        body: `A new application was submitted${data.jobTitle ? ` for "${data.jobTitle}"` : ""}${data.fullName ? ` by ${data.fullName}` : ""}${data.email ? ` (${data.email})` : ""}.`
      },
      property_submitted: {
        title: "Property Submitted for Review",
        body: `A new property "${data.propertyTitle || 'Property'}" has been submitted for review and is awaiting your approval.`
      },
      property_approved: {
        title: "Property Approved",
        body: `Property "${data.propertyTitle || 'Property'}" has been approved${data.approvedByName ? ` by ${data.approvedByName}` : ''}.`
      },
      property_rejected: {
        title: "Property Review Update",
        body: `Property "${data.propertyTitle || 'Property'}" has been rejected. ${data.reasons ? `Reasons: ${Array.isArray(data.reasons) ? data.reasons.join(', ') : data.reasons}.` : ''}`
      },
      cancellation_submitted: {
        title: "New Cancellation Claim Submitted",
        body: `A customer submitted a cancellation claim${data.bookingCode ? ` (code: ${data.bookingCode})` : ""}.`
      },
      cancellation_message: {
        title: "New Cancellation Message",
        body: `There is a new message on cancellation claim${data.requestId ? ` #${data.requestId}` : ""}${data.bookingCode ? ` (code: ${data.bookingCode})` : ""}.`
      },
      tour_cancellation_submitted: {
        title: "New Tour Cancellation Request",
        body: `Tour cancellation case #${data.caseId || ""} was submitted for booking ${data.bookingCode || ""}. Review policy eligibility, booking impact, and operator evidence.`
      },
      tour_cancellation_evidence_submitted: {
        title: "Tour Cancellation Evidence Submitted",
        body: `${data.actor || "A participant"} submitted evidence for tour cancellation case #${data.caseId || ""}, booking ${data.bookingCode || ""}.`
      },
      plan_request_submitted: {
        title: "New Plan Request Submitted",
        body: `A new plan request${data.requestId ? ` #${data.requestId}` : ""} has been submitted${data.customerName ? ` by ${data.customerName}` : ""}${data.role ? ` (${data.role})` : ""}.`
      },
      booking_created: {
        title: "New Booking Created",
        body: `A new booking${data.bookingId ? ` #${data.bookingId}` : ""} has been created${data.propertyTitle ? ` for "${data.propertyTitle}"` : ""}${data.checkIn ? ` (check-in: ${data.checkIn})` : ""}.`
      },

      group_stay_message: {
        title: "Group Stay Follow-up",
        body: `${data.customerName || "A customer"} sent a message on group stay #${data.groupBookingId}${data.messageType && data.messageType !== "General" ? ` (${data.messageType})` : ""}: "${data.message}"`
      },

      payout_claim_submitted: {
        title: "Tour Payout Claim Submitted",
        body: `${data.operatorName ? `${data.operatorName} ` : "An operator "}submitted a payout claim for booking ${data.bookingCode || `#${data.tourBookingId}`}. Review it in the tour revenue dashboard.`
      },

      owner_payout_claim_submitted: {
        title: "Owner Payout Invoice Submitted",
        body: `${data.ownerName ? `${data.ownerName} ` : "A property owner "}submitted invoice ${data.invoiceNumber || `#${data.invoiceId}`} for a payout claim${data.propertyTitle ? ` for "${data.propertyTitle}"` : data.bookingId ? ` on booking #${data.bookingId}` : ""}. Review it in the admin revenue dashboard.`
      },

      // Transport (driver allocation) escalations
      transport_auto_dispatch_no_drivers_2m: {
        title: "No Driver Acceptance Yet (2 min)",
        body: `A transport trip${data.transportBookingId ? ` #${data.transportBookingId}` : ""} has no driver acceptance after 2 minutes. The system will keep scanning/offering, but you may start preparing manual assignment.`
      },
      transport_auto_dispatch_warning: {
        title: "Trip Allocation Delay (5 min)",
        body: `A transport trip${data.transportBookingId ? ` #${data.transportBookingId}` : ""} has not been assigned after 5 minutes. Prepare for manual assignment if no driver accepts by 10 minutes.`
      },
      transport_auto_dispatch_takeover: {
        title: "Manual Assignment Required (10 min)",
        body: `A transport trip${data.transportBookingId ? ` #${data.transportBookingId}` : ""} was not assigned within 10 minutes. Admin manual assignment is now required.`
      },
      transport_payout_claim_submitted: {
        title: "Driver Payout Claim Submitted",
        body: `${data.driverName ? `${data.driverName} ` : "A driver "}submitted a payout claim for trip${data.transportBookingId ? ` #${data.transportBookingId}` : ""}. Review and approve it in the driver payouts dashboard.`
      },
    };

    const templateData = notificationTemplates[template] || {
      title: "Admin Notification",
      body: `Update: ${JSON.stringify(data)}`
    };

    try {
      // Create notification for admins (no userId/ownerId = visible to all admins)
      const created = await prisma.notification.create({
        data: {
          userId: null,
          ownerId: null,
          title: templateData.title,
          body: templateData.body,
          unread: true,
          meta: data,
          type: template.startsWith("transport")
            ? "ride"
            : template.startsWith("careers")
              ? "careers"
            : template.startsWith("owner_payout")
              ? "invoice"
            : template.startsWith("cancellation")
              ? "cancellation"
              : template.startsWith("group_stay")
                ? "booking"
              : template.startsWith("booking")
                ? "booking"
                : "property"
        }
      });

      // Best-effort realtime delivery to authenticated admin dashboards.
      // The database record remains the source of truth if Socket.IO is unavailable.
      try {
        const io = (global as any).io;
        if (io && typeof io.to === "function") {
          const urgent = template === "transport_auto_dispatch_warning"
            || template === "transport_auto_dispatch_takeover";

          io.to("admin").emit("admin:notification:new", {
            id: created.id,
            title: created.title,
            body: created.body,
            type: created.type,
            template,
            priority: urgent ? "urgent" : "normal",
            createdAt: created.createdAt,
          });
        }
      } catch {
        // Realtime delivery is optional; the saved inbox notification is not affected.
      }
    } catch (err: any) {
      console.error("[notify] admins - failed to create notification", err?.message || err, template);
    }
  } catch (err: any) {
    console.error("[notify] admins failed", err?.message || err);
  }
}

export async function notifyOwner(ownerId: number, template: string, data: any) {
  try {
    // Create notification in database if Notification model exists
    const notificationTemplates: Record<string, { title: string; body: string }> = {
      property_submitted: {
        title: "Property Submitted for Review",
        body: `Your property "${data.propertyTitle || 'Property'}" has been submitted and is now under review by our team. You will be notified once the review is complete.`
      },
      property_approved: {
        title: "Property Approved",
        body: `Great news! Your property "${data.propertyTitle || 'Property'}" has been approved and is now live on the platform.`
      },
      property_rejected: {
        title: "Property Review Update",
        body: `Your property "${data.propertyTitle || 'Property'}" requires some changes. ${data.reasons ? `Reasons: ${Array.isArray(data.reasons) ? data.reasons.join(', ') : data.reasons}.` : ''} ${data.note ? `Note: ${data.note}` : ''}`
      },
      property_suspended: {
        title: "Property Suspended",
        body: `Your property "${data.propertyTitle || 'Property'}" has been temporarily suspended. ${data.reason ? `Reason: ${data.reason}` : ''}`
      },
      property_unsuspended: {
        title: "Property Reinstated",
        body: `Your property "${data.propertyTitle || 'Property'}" has been reinstated and is now live again.`
      },
      cancellation_status_update: {
        title: "Cancellation Claim Update",
        body: `Your cancellation claim${data.requestId ? ` #${data.requestId}` : ""}${data.bookingCode ? ` (code: ${data.bookingCode})` : ""} is now "${data.status || "UPDATED"}". ${data.decisionNote ? `Note: ${data.decisionNote}` : ""}`
      },
      cancellation_message: {
        title: "New Message on Cancellation Claim",
        body: `You have a new message on your cancellation claim${data.requestId ? ` #${data.requestId}` : ""}${data.bookingCode ? ` (code: ${data.bookingCode})` : ""}.`
      },
      tour_cancellation_evidence_requested: {
        title: "Evidence requested for your tour cancellation",
        body: `NoLSAF requested supporting evidence for tour cancellation case #${data.caseId || ""}. Open your tour booking and upload the requested files in the cancellation case.`
      },
      tour_case_operator_message: {
        title: "Tour operator responded to your case",
        body: `Your tour operator added an update to case #${data.caseId || ""}${data.bookingCode ? ` for booking ${data.bookingCode}` : ""}. Open the tour booking to review the shared case activity.`
      },
      booking_created: {
        title: "New Booking Received",
        body: `You have a new booking${data.bookingId ? ` #${data.bookingId}` : ""}${data.propertyTitle ? ` for "${data.propertyTitle}"` : ""}${data.checkIn ? ` (check-in: ${data.checkIn})` : ""}. Open your bookings to view details and prepare for check-in.`
      },
      // Progressive cancellation stages — one template per admin step
      cancellation_reviewing: {
        title: "Cancellation Request Under Review",
        body: `A guest has requested to cancel their booking${data.bookingId ? ` #${data.bookingId}` : ""}${data.propertyTitle ? ` at "${data.propertyTitle}"` : ""}${data.bookingCode ? ` (code: ${data.bookingCode})` : ""}. The admin team is reviewing this request. No changes to your booking yet.`
      },
      cancellation_processing: {
        title: "Booking Cancelled — Refund Processing",
        body: `The cancellation request for booking${data.bookingId ? ` #${data.bookingId}` : ""}${data.propertyTitle ? ` at "${data.propertyTitle}"` : ""}${data.bookingCode ? ` (code: ${data.bookingCode})` : ""} has been approved. The booking is now cancelled and the check-in code has been voided. The guest's refund is being processed.`
      },
      cancellation_refunded: {
        title: "Guest Refund Completed",
        body: `The refund for the cancelled booking${data.bookingId ? ` #${data.bookingId}` : ""}${data.propertyTitle ? ` at "${data.propertyTitle}"` : ""}${data.bookingCode ? ` (code: ${data.bookingCode})` : ""} has been completed. The guest has received their payment.`
      },
      cancellation_rejected: {
        title: "Cancellation Request Rejected",
        body: `The cancellation request for booking${data.bookingId ? ` #${data.bookingId}` : ""}${data.propertyTitle ? ` at "${data.propertyTitle}"` : ""}${data.bookingCode ? ` (code: ${data.bookingCode})` : ""} has been rejected. The booking remains active and the check-in code is still valid.`
      },
      // NRMS admin enforcement (NRMS_ADMIN_OVERSIGHT.md phase 2). Every action
      // is reasoned and the owner is always told what happened and why.
      nrms_enrollment_suspended: {
        title: "NRMS Access Suspended",
        body: `Your NRMS workspace has been suspended by NoLSAF. ${data.reason ? `Reason: ${data.reason}.` : ""} Your marketplace account is not affected. Contact support to resolve this.`
      },
      nrms_enrollment_restored: {
        title: "NRMS Access Restored",
        body: `Your NRMS workspace has been restored. ${data.reason ? `Note: ${data.reason}.` : ""} All property operations are available again.`
      },
      nrms_property_frozen: {
        title: "NRMS Property Frozen",
        body: `NRMS operations for "${data.propertyTitle || 'your property'}" have been frozen by NoLSAF. ${data.reason ? `Reason: ${data.reason}.` : ""} Your other properties are not affected. Contact support to resolve this.`
      },
      nrms_property_unfrozen: {
        title: "NRMS Property Reopened",
        body: `NRMS operations for "${data.propertyTitle || 'your property'}" are open again. ${data.reason ? `Note: ${data.reason}.` : ""}`
      },
      nrms_staff_disabled: {
        title: "NRMS Staff Member Disabled",
        body: `The staff member ${data.staffName || 'account'} has been disabled across all NRMS properties by NoLSAF. ${data.reason ? `Reason: ${data.reason}.` : ""} Their sessions have been signed out.`
      },
      nrms_invites_invalidated: {
        title: "Pending NRMS Staff Invites Cancelled",
        body: `Pending staff invites for "${data.propertyTitle || 'your property'}" were cancelled by NoLSAF. ${data.reason ? `Reason: ${data.reason}.` : ""} You can re-invite staff at any time.`
      },
      nrms_qr_ordering_frozen: {
        title: "Guest QR Ordering Paused",
        body: `Guest QR ordering for "${data.propertyTitle || 'your property'}" has been paused by NoLSAF. ${data.reason ? `Reason: ${data.reason}.` : ""} Staff ordering continues to work normally.`
      },
      nrms_qr_ordering_unfrozen: {
        title: "Guest QR Ordering Resumed",
        body: `Guest QR ordering for "${data.propertyTitle || 'your property'}" is live again. ${data.reason ? `Note: ${data.reason}.` : ""}`
      },
      nrms_qr_points_deactivated: {
        title: "QR Order Points Deactivated",
        body: `All QR order points for "${data.propertyTitle || 'your property'}" were deactivated by NoLSAF. ${data.reason ? `Reason: ${data.reason}.` : ""} You can rotate them to print fresh codes once resolved.`
      },
      nrms_pay_instructions_cleared: {
        title: "Guest Payment Details Removed",
        body: `The guest payment details shown on your QR order page for "${data.propertyTitle || 'your property'}" were removed by NoLSAF pending review. ${data.reason ? `Reason: ${data.reason}.` : ""} Please re-enter correct details on the QR order points page.`
      },
      nrms_trial_changed: {
        title: "NRMS Trial Date Updated",
        body: `The NRMS trial for "${data.propertyTitle || 'your property'}" now ends on ${data.trialEndsAt ? new Date(data.trialEndsAt).toLocaleDateString("en-TZ") : 'the updated date'}. ${data.shortening ? 'This change includes at least 7 days notice. ' : ''}${data.reason ? `Reason: ${data.reason}.` : ""}`
      },
      nrms_unpaid_limit_changed: {
        title: "NRMS Account Limit Updated",
        body: `The unpaid NRMS limit for "${data.propertyTitle || 'your property'}" is now TZS ${Number(data.unpaidLimit || 0).toLocaleString("en-TZ")}. ${data.reason ? `Reason: ${data.reason}.` : ""}`
      },
      nrms_credit_granted: {
        title: "NRMS Credit Applied",
        body: `NoLSAF applied a TZS ${Number(data.amount || 0).toLocaleString("en-TZ")} credit to "${data.propertyTitle || 'your property'}". ${data.reason ? `Reason: ${data.reason}.` : ""}`
      },
      nrms_policy_changed: {
        title: "NRMS Pricing Policy Updated",
        body: `"${data.propertyTitle || 'Your property'}" now uses NRMS pricing policy ${data.version || 'the selected version'}. Existing usage charges did not change. ${data.reason ? `Reason: ${data.reason}.` : ""}`
      },
      nrms_balance_reminder: {
        title: "NRMS Balance Reminder",
        body: `The NRMS balance for "${data.propertyTitle || 'your property'}" is TZS ${Number(data.unpaidBalance || 0).toLocaleString("en-TZ")}. You can continue operating and pay from the NRMS billing page.`
      },
      nrms_balance_warning: {
        title: "NRMS Balance Warning",
        body: `The NRMS balance for "${data.propertyTitle || 'your property'}" is TZS ${Number(data.unpaidBalance || 0).toLocaleString("en-TZ")}. If it reaches the TZS ${Number(data.unpaidLimit || 0).toLocaleString("en-TZ")} limit, a ${Number(data.graceDays || 0)} day grace period starts before operations are restricted.`
      },
      nrms_payment_required: {
        title: "NRMS Payment Required",
        body: `The grace period for "${data.propertyTitle || 'your property'}" has ended. Settle the NRMS statement to restore normal operations.`
      },
      nrms_payment_reconciled: {
        title: "NRMS Payment Reconciled",
        body: `NoLSAF reconciled the NRMS payment for "${data.propertyTitle || 'your property'}". ${data.reason ? `Reason: ${data.reason}.` : ""}`
      },
      nrms_payment_token_voided: {
        title: "NRMS Payment Attempt Voided",
        body: `A payment attempt for "${data.propertyTitle || 'your property'}" was voided so you can retry. ${data.reason ? `Reason: ${data.reason}.` : ""}`
      },
      nrms_signal_reviewed: {
        title: "NRMS Activity Review",
        body: `NoLSAF reviewed ${String(data.kind || 'an activity signal').replace(/_/g, ' ').toLowerCase()} for "${data.propertyTitle || 'your property'}". ${data.reason ? `Note: ${data.reason}.` : ""} This review did not automatically restrict your account.`
      },
      nrms_dispute_exported: {
        title: "NRMS Support Export Created",
        body: `NoLSAF created a support export for "${data.propertyTitle || 'your property'}" covering the requested period. ${data.reason ? `Reason: ${data.reason}.` : ""}`
      },
      nrms_retention_scheduled: {
        title: "NRMS Data Retention Scheduled",
        body: `Closed-account retention was scheduled for "${data.propertyTitle || 'your property'}". Guest identifiers are retained for ${Number(data.guestRetentionDays || 730)} days and operational free text for ${Number(data.operationalRetentionDays || 2555)} days from closure. Financial and audit records remain. ${data.reason ? `Reason: ${data.reason}.` : ""}`
      },
      // Legacy alias kept for backward compatibility
      booking_cancelled_by_guest: {
        title: "Booking Cancelled — Refund Processing",
        body: `A guest's cancellation request for booking${data.bookingId ? ` #${data.bookingId}` : ""}${data.propertyTitle ? ` at "${data.propertyTitle}"` : ""}${data.bookingCode ? ` (code: ${data.bookingCode})` : ""} has been approved. The check-in code has been voided and the booking is now cancelled.`
      },
    };

    const templateData = notificationTemplates[template] || {
      title: "Notification",
      body: `Update regarding your property.`
    };

    // Create notification in database (this is the "on-site inbox")
    try {
      const created = await prisma.notification.create({
        data: {
          ownerId: Number(ownerId),
          userId: Number(ownerId), // Also set userId for consistency
          title: templateData.title,
          body: templateData.body,
          unread: true,
          meta: data,
          type: template.startsWith("cancellation")
            ? "cancellation"
            : template.startsWith("booking")
              ? "booking"
              : "property"
        }
      });

      // Best-effort realtime emit (if clients join rooms)
      try {
        const io = (global as any).io;
        if (io && typeof io.to === "function") {
          io.to(`owner:${ownerId}`).emit("notification:new", { id: created.id, ownerId, type: created.type, title: created.title, body: created.body, createdAt: created.createdAt });
          io.to(`user:${ownerId}`).emit("notification:new", { id: created.id, userId: ownerId, type: created.type, title: created.title, body: created.body, createdAt: created.createdAt });
        }
      } catch {
        // ignore
      }
    } catch (err: any) {
      // Log error but don't fail the main operation
      console.error("[notify] owner - failed to create notification", err?.message || err, ownerId, template);
    }
  } catch (err: any) {
    console.error("[notify] owner failed", err?.message || err);
  }
}

/**
 * Notify a user (customer) by userId
 */
export async function notifyUser(userId: number, template: string, data: any) {
  try {
    const notificationTemplates: Record<string, { title: string; body: string }> = {
      agent_assignment_assigned: {
        title: "New assignment assigned",
        body: `You have a new assignment${data.requestId ? ` #${data.requestId}` : ""}${data.tripType ? ` (${data.tripType})` : ""}. Open your dashboard to view details.`
      },
      agent_assignment_updated: {
        title: "Assignment updated by admin",
        body: `Your assignment${data.requestId ? ` #${data.requestId}` : ""} has an update from the admin team. Open the assignment to review the latest details.`
      },
      agent_assignment_completed: {
        title: "Assignment marked completed",
        body: `Assignment${data.requestId ? ` #${data.requestId}` : ""} was marked COMPLETED. Check the assignment for the final response and outputs.`
      },
      agent_tour_booking_paid: {
        title: "New Paid Tour Booking",
        body: `Tour booking ${data.bookingCode || ""} has been paid. Guest: ${data.guestName || "Unknown"}. Amount: ${data.currency || ""} ${Number(data.amount || 0).toLocaleString("en-US")}.`
      },
      agent_payout_verified: {
        title: "Payout Claim Verified",
        body: `Your payout claim for booking ${data.bookingCode || `#${data.tourBookingId}`} has been verified by NoLSAF. ${data.reason ? `Note: ${data.reason}` : "It is now awaiting approval."}`
      },
      agent_payout_approved: {
        title: "Payout Approved",
        body: `Your payout for booking ${data.bookingCode || `#${data.tourBookingId}`} has been approved and is queued for disbursement.`
      },
      agent_payout_disbursed: {
        title: "Payout Disbursed",
        body: `Your payout for booking ${data.bookingCode || `#${data.tourBookingId}`} has been disbursed${data.paymentRef ? ` (ref: ${data.paymentRef})` : ""}. Check your revenues page for details.`
      },
      agent_payout_rejected: {
        title: "Payout Claim Rejected",
        body: `Your payout claim for booking ${data.bookingCode || `#${data.tourBookingId}`} was rejected. ${data.reason ? `Reason: ${data.reason}` : "Contact NoLSAF support for details."}`
      },
      cancellation_status_update: {
        title: "Cancellation Claim Update",
        body: `Your cancellation claim${data.requestId ? ` #${data.requestId}` : ""}${data.bookingCode ? ` (code: ${data.bookingCode})` : ""} is now "${data.status || "UPDATED"}". ${data.decisionNote ? `Note: ${data.decisionNote}` : ""}`
      },
      cancellation_message: {
        title: "New Message on Cancellation Claim",
        body: `You have a new message on your cancellation claim${data.requestId ? ` #${data.requestId}` : ""}${data.bookingCode ? ` (code: ${data.bookingCode})` : ""}.`
      },
      group_stay_update: {
        title: data.title || "Group Stay Update",
        body: data.body || data.message || "You have an update on your group stay booking."
      },
      document_concern: {
        title: "Document concern on your booking",
        body: `Your tour operator raised a concern about traveller documents for booking ${data.bookingCode || ""}${data.memberName ? ` (traveller: ${data.memberName})` : ""}: ${data.message || "Please review your uploaded documents."}`
      },
    };

    const templateData = notificationTemplates[template] || {
      title: "Notification",
      body: "You have an update."
    };

    const created = await prisma.notification.create({
      data: {
        userId: Number(userId),
        ownerId: null,
        title: templateData.title,
        body: templateData.body,
        unread: true,
        meta: data,
        type: template.startsWith("agent_")
          ? "agent"
          : template.startsWith("cancellation")
            ? "cancellation"
            : template === "document_concern"
              ? "booking"
              : "system"
      }
    });

    // Best-effort realtime emit
    try {
      const io = (global as any).io;
      if (io && typeof io.to === "function") {
        io.to(`user:${userId}`).emit("notification:new", { id: created.id, userId, type: created.type, title: created.title, body: created.body, createdAt: created.createdAt });
      }
    } catch {
      // ignore
    }
  } catch (err: any) {
    console.error("[notify] user failed", err?.message || err);
  }
}
