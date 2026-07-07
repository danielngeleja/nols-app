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
