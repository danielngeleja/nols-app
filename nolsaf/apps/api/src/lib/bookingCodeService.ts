import { prisma } from "@nolsaf/prisma";
import { Prisma } from "@prisma/client";
import crypto from "crypto";
import { sendSms } from "./sms.js";
import { sendMail } from "./mailer.js";
import { getBookingValidationWindowStatus } from "./bookingValidationWindow.js";
import { updateNoLsafBookingStatus } from "./nolsafMarketplaceNrms.js";

function getModelFieldSet(modelName: string): Set<string> | null {
  try {
    const models = (prisma as any)?._runtimeDataModel?.models;
    const m = models?.[modelName];
    const fields = m?.fields;
    if (!Array.isArray(fields)) return null;
    return new Set(fields.map((f: any) => String(f?.name)));
  } catch {
    return null;
  }
}

function hasModelField(modelName: string, fieldName: string): boolean {
  const set = getModelFieldSet(modelName);
  if (!set) return false;
  return set.has(fieldName);
}

/**
 * Generate a unique, human-readable booking code
 * Format: 8 characters, no confusing characters (no 0, O, I, 1)
 */
function generateBookingCode(length = 8): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // No 0, O, I, 1
  let code = "";
  for (let i = 0; i < length; i++) {
    code += alphabet[crypto.randomInt(0, alphabet.length)];
  }
  return code;
}

/**
 * Hash a booking code for secure storage
 */
function hashCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

/**
 * Generate and store a unique booking code for a booking
 * This is idempotent - if a code already exists, it returns the existing one
 */
export async function generateBookingCodeForBooking(bookingId: number): Promise<{
  id: number;
  code: string;
  bookingId: number;
  status: string;
}> {
  // Check if code already exists
  const existing = await prisma.checkinCode.findUnique({
    where: { bookingId },
  });

  if (existing && existing.status === "ACTIVE") {
    return {
      id: existing.id,
      code: existing.code,
      bookingId: existing.bookingId,
      status: existing.status,
    };
  }

  // Generate unique code (retry on collision)
  let code: string;
  let attempts = 0;
  const maxAttempts = 10;

  while (attempts < maxAttempts) {
    code = generateBookingCode(8);
    const codeHash = hashCode(code);

    try {
      const created = await prisma.checkinCode.create({
        data: {
          bookingId,
          code,
          codeHash,
          codeVisible: code, // For backward compatibility
          status: "ACTIVE",
          generatedAt: new Date(),
        },
      });

      return {
        id: created.id,
        code: created.code,
        bookingId: created.bookingId,
        status: created.status,
      };
    } catch (error: any) {
      // If unique constraint violation, try again
      if (error?.code === "P2002" || error?.message?.includes("Unique constraint")) {
        attempts++;
        continue;
      }
      throw error;
    }
  }

  throw new Error("Failed to generate unique booking code after multiple attempts");
}

/**
 * Format booking details for notification
 */
function formatBookingDetails(booking: any, property: any, user: any): {
  sms: string;
  email: {
    subject: string;
    html: string;
  };
} {
  const checkIn = new Date(booking.checkIn).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const checkOut = new Date(booking.checkOut).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const nights = Math.ceil(
    (new Date(booking.checkOut).getTime() - new Date(booking.checkIn).getTime()) /
      (1000 * 60 * 60 * 24)
  );

  const guestName = booking.guestName || user?.name || "Guest";
  const propertyTitle = property?.title || "Property";
  const roomType = booking.roomType || "Room";
  const amount = Number(booking.totalAmount || 0).toLocaleString("en-US");
  const nationality = booking.nationality || "Not specified";

  // SMS message (concise)
  const smsMessage = `NoLSAF Booking Confirmed!\n\nBooking Code: ${booking.code?.code || "N/A"}\nGuest: ${guestName}\nProperty: ${propertyTitle}\nRoom: ${roomType}\nCheck-in: ${checkIn}\nCheck-out: ${checkOut}\nNights: ${nights}\nAmount: ${amount} TZS\n\nPresent this code at check-in. Thank you!`;

  // Email HTML (detailed)
  const emailHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #02665e; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
        .code-box { background: white; border: 3px solid #02665e; padding: 20px; text-align: center; margin: 20px 0; border-radius: 8px; }
        .code { font-size: 32px; font-weight: bold; color: #02665e; letter-spacing: 4px; }
        .details { background: white; padding: 20px; margin: 15px 0; border-radius: 8px; }
        .detail-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #eee; }
        .detail-label { font-weight: bold; color: #666; }
        .detail-value { color: #333; }
        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Booking Confirmation</h1>
          <p>NoLSAF - Your Stay, Our Promise</p>
        </div>
        <div class="content">
          <p>Dear ${guestName},</p>
          <p>Your booking has been confirmed! Please find your booking details below:</p>
          
          <div class="code-box">
            <div style="font-size: 14px; color: #666; margin-bottom: 10px;">Your Booking Code</div>
            <div class="code">${booking.code?.code || "N/A"}</div>
            <div style="font-size: 12px; color: #666; margin-top: 10px;">Present this code at check-in</div>
          </div>

          <div class="details">
            <h3 style="margin-top: 0;">Personal Information</h3>
            <div class="detail-row">
              <span class="detail-label">Full Name:</span>
              <span class="detail-value">${guestName}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Nationality:</span>
              <span class="detail-value">${nationality}</span>
            </div>
            ${booking.guestPhone ? `
            <div class="detail-row">
              <span class="detail-label">Phone:</span>
              <span class="detail-value">${booking.guestPhone}</span>
            </div>
            ` : ""}
          </div>

          <div class="details">
            <h3 style="margin-top: 0;">Booking Details</h3>
            <div class="detail-row">
              <span class="detail-label">Property:</span>
              <span class="detail-value">${propertyTitle}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Room Type:</span>
              <span class="detail-value">${roomType}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Check-in Date:</span>
              <span class="detail-value">${checkIn}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Check-out Date:</span>
              <span class="detail-value">${checkOut}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Number of Nights:</span>
              <span class="detail-value">${nights}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Total Amount Paid:</span>
              <span class="detail-value">${amount} TZS</span>
            </div>
          </div>

          <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; border-radius: 4px;">
            <strong>Important:</strong> Please present your booking code at the property during check-in. 
            This code is unique to your booking and will be used to verify your reservation.
          </div>

          <p>We look forward to hosting you!</p>
          <p>Best regards,<br>The NoLSAF Team</p>
        </div>
        <div class="footer">
          <p>This is an automated message. Please do not reply to this email.</p>
          <p>For support, contact: ${process.env.SUPPORT_EMAIL || "support@nolsaf.com"}</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return {
    sms: smsMessage,
    email: {
      subject: `Booking Confirmation - ${booking.code?.code || "NoLSAF"}`,
      html: emailHtml,
    },
  };
}

/**
 * Send booking code notification via SMS and/or Email
 */
export async function sendBookingCodeNotification(
  bookingId: number,
  options: { sendSms?: boolean; sendEmail?: boolean } = {}
): Promise<{ smsSent: boolean; emailSent: boolean; errors: string[] }> {
  const { sendSms: shouldSendSms = true, sendEmail: shouldSendEmail = true } = options;
  const errors: string[] = [];
  let smsSent = false;
  let emailSent = false;

  try {
    // Fetch booking with all related data
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        code: true,
        property: {
          include: {
            owner: true,
          },
        },
        user: true,
      },
    });

    if (!booking) {
      throw new Error(`Booking ${bookingId} not found`);
    }

    if (!booking.code) {
      // Generate code if it doesn't exist
      await generateBookingCodeForBooking(bookingId);
      // Re-fetch booking with code
      const updated = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: {
          code: true,
          property: {
            include: {
              owner: true,
            },
          },
          user: true,
        },
      });
      if (!updated || !updated.code) {
        throw new Error("Failed to generate booking code");
      }
      Object.assign(booking, updated);
    }

    // Format notification content
    const notification = formatBookingDetails(booking, booking.property, booking.user);

    // Send SMS
    if (shouldSendSms) {
      const phone = booking.guestPhone || booking.user?.phone;
      if (phone) {
        try {
          const smsResult = await sendSms(phone, notification.sms);
          if (smsResult.success) {
            smsSent = true;
            // Mark code as issued
            if (booking.code) {
              await prisma.checkinCode.update({
                where: { id: booking.code.id },
                data: { issuedAt: new Date() },
              });
            }
          } else {
            errors.push(`SMS failed: ${smsResult.error || "Unknown error"}`);
          }
        } catch (smsError: any) {
          errors.push(`SMS error: ${smsError.message}`);
        }
      } else {
        errors.push("No phone number available for SMS");
      }
    }

    // Send Email
    if (shouldSendEmail) {
      // Check both user email (for logged-in users) and guestEmail (for public bookings)
      const email = booking.user?.email || (booking as any).guestEmail;
      if (email) {
        try {
          await sendMail(email, notification.email.subject, notification.email.html);
          emailSent = true;
          // Mark code as issued if not already
          if (booking.code && !booking.code.issuedAt) {
            await prisma.checkinCode.update({
              where: { id: booking.code.id },
              data: { issuedAt: new Date() },
            });
          }
        } catch (emailError: any) {
          errors.push(`Email error: ${emailError.message}`);
        }
      } else {
        errors.push("No email address available");
      }
    }

    return { smsSent, emailSent, errors };
  } catch (error: any) {
    errors.push(`Notification error: ${error.message}`);
    return { smsSent, emailSent, errors };
  }
}

/**
 * Validate a booking code and return booking details
 * @param code - The booking code to validate
 * @param ownerId - Optional owner ID to verify ownership
 * @param allowUsed - If true, allows validation of USED codes (for cancellation checks). Default: false
 */
export async function validateBookingCode(
  code: string,
  ownerId?: number,
  allowUsed: boolean = false
): Promise<{
  valid: boolean;
  booking?: any;
  error?: string;
  cancellationStatus?: string | null;
}> {
  try {
    if (!code || typeof code !== 'string') {
      return { valid: false, error: "Code is required" };
    }

    const normalizedCode = code.toUpperCase().trim();
    if (!normalizedCode) {
      return { valid: false, error: "Code cannot be empty" };
    }

    const codeHash = hashCode(normalizedCode);
    
    console.log(`[validateBookingCode] Looking up code: "${normalizedCode}", hash: ${codeHash.substring(0, 16)}..., allowUsed: ${allowUsed}`);
    
    // Try to find the code by multiple methods:
    // 1. Direct code match (case-sensitive)
    // 2. Code hash match (most reliable)
    // 3. codeVisible match (backward compatibility)
    const where = {
      OR: [{ code: normalizedCode }, { codeHash }, { codeVisible: normalizedCode }],
    } as const;

    const bookingSelectBase: any = {
      id: true,
      propertyId: true,
      checkIn: true,
      checkOut: true,
      status: true,
    };
    const optionalBookingFields = [
      'totalAmount',
      'includeTransport',
      'transportFare',
      'guestName',
      'guestPhone',
      'nationality',
      'sex',
      'ageGroup',
      'roomType',
      'roomCode',
      'rooms',
      'roomsQty',
    ];
    for (const f of optionalBookingFields) {
      if (hasModelField('Booking', f)) bookingSelectBase[f] = true;
    }

    const propertySelectBase: any = {
      id: true,
      title: true,
    };
    // We need ownerId to enforce owner scoping. Select it if present.
    if (hasModelField('Property', 'ownerId')) propertySelectBase.ownerId = true;
    if (hasModelField('Property', 'type')) propertySelectBase.type = true;
    if (hasModelField('Property', 'basePrice')) propertySelectBase.basePrice = true;
    if (hasModelField('Property', 'currency')) propertySelectBase.currency = true;
    if (hasModelField('Property', 'services')) propertySelectBase.services = true;

    // IMPORTANT:
    // Never `include: { property: true }` here — it selects all Property columns.
    // If the database is behind the Prisma schema, Prisma may try to read columns that
    // don't exist (e.g. Property.tourismSiteId) and throw P2022.
    let checkinCode: any = null;
    try {
      checkinCode = await prisma.checkinCode.findFirst({
        where,
        select: {
          id: true,
          status: true,
          code: true,
          codeVisible: true,
          codeHash: true,
          usedAt: true,
          voidReason: true,
          voidedAt: true,
          booking: {
            select: {
              ...bookingSelectBase,
              cancellationRequests: {
                select: { id: true, status: true },
                orderBy: { createdAt: 'desc' },
                take: 1,
              },
              property: {
                select: {
                  ...propertySelectBase,
                },
              },
              user: {
                select: {
                  id: true,
                  name: true,
                  phone: true,
                  email: true,
                },
              },
            },
          },
        },
      });
    } catch (err: any) {
      // If the DB is missing *any* of the selected columns, retry with a smaller shape.
      if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2021' || err.code === 'P2022')) {
        checkinCode = await prisma.checkinCode.findFirst({
          where,
          select: {
            id: true,
            status: true,
            code: true,
            codeVisible: true,
            codeHash: true,
            usedAt: true,
            voidReason: true,
            voidedAt: true,
            booking: {
              select: {
                ...bookingSelectBase,
                cancellationRequests: {
                  select: { id: true, status: true },
                  orderBy: { createdAt: 'desc' },
                  take: 1,
                },
                property: {
                  select: {
                    id: true,
                    title: true,
                    ...(hasModelField('Property', 'ownerId') ? { ownerId: true } : {}),
                  },
                },
                user: {
                  select: {
                    id: true,
                    name: true,
                    phone: true,
                  },
                },
              },
            },
          },
        });
      } else {
        throw err;
      }
    }

    if (!checkinCode) {
      console.error(`[validateBookingCode] Code not found: ${normalizedCode} (hash: ${codeHash})`);
      return { valid: false, error: "Invalid booking code" };
    }

    // Check if booking exists
    if (!checkinCode.booking) {
      console.error(`[validateBookingCode] Code found but booking missing: ${checkinCode.id}`);
      return { valid: false, error: "Booking not found for this code" };
    }

    // Check if property exists
    if (!checkinCode.booking.property) {
      console.error(`[validateBookingCode] Booking found but property missing: ${checkinCode.booking.id}`);
      return { valid: false, error: "Property not found for this booking" };
    }

    // Check code status - reject USED codes unless explicitly allowed (for cancellation checks)
    if (checkinCode.status === "USED" && !allowUsed) {
      console.log(`[validateBookingCode] Code already used: ${normalizedCode}`);
      return {
        valid: false,
        error: "This code has already been validated and cannot be used again",
      };
    }

    if (checkinCode.status === "VOID") {
      const latestCancellation = checkinCode.booking?.cancellationRequests?.[0] ?? null;
      let error: string;
      if (latestCancellation) {
        switch (latestCancellation.status) {
          case "SUBMITTED":
          case "REVIEWING":
            error = "This booking has a cancellation request currently under review. The code has been suspended pending admin decision.";
            break;
          case "PROCESSING":
            error = "This booking's cancellation has been approved and is being processed. The code has been voided. The guest will be refunded.";
            break;
          case "REFUNDED":
            error = "This booking was cancelled and the guest has been refunded. The check-in code is no longer valid.";
            break;
          case "REJECTED":
            error = "A cancellation request existed for this booking but was rejected. The code was voided by an admin, Please contact support.";
            break;
          default:
            error = checkinCode.voidReason
              ? `This check-in code has been voided: ${checkinCode.voidReason}`
              : "This check-in code has been voided.";
        }
      } else {
        error = checkinCode.voidReason
          ? `This check-in code has been voided: ${checkinCode.voidReason}`
          : "This check-in code has been voided.";
      }
      return {
        valid: false,
        error,
        cancellationStatus: latestCancellation?.status ?? null,
      };
    }

    if (checkinCode.status !== "ACTIVE" && checkinCode.status !== "USED") {
      return {
        valid: false,
        error: `Invalid code status: ${checkinCode.status}`,
      };
    }

    // If ownerId is provided, verify the booking belongs to this owner
    if (ownerId !== undefined && ownerId !== null) {
      const propertyOwnerId = checkinCode.booking.property?.ownerId;
      if (!propertyOwnerId) {
        console.error(`[validateBookingCode] Property ownerId missing: ${checkinCode.booking.property?.id}`);
        return { valid: false, error: "Property owner information is missing" };
      }
      
      if (Number(propertyOwnerId) !== Number(ownerId)) {
        console.error(`[validateBookingCode] Owner mismatch: expected ${ownerId}, got ${propertyOwnerId} for code ${normalizedCode}`);
        return { valid: false, error: "This booking does not belong to your property" };
      }
    }

    const bookingWithCode = {
      ...checkinCode.booking,
      code: {
        id: checkinCode.id,
        status: checkinCode.status,
        code: checkinCode.code,
        codeVisible: checkinCode.codeVisible,
        codeHash: checkinCode.codeHash,
        usedAt: checkinCode.usedAt,
      },
    };

    return { valid: true, booking: bookingWithCode };
  } catch (error: any) {
    console.error(`[validateBookingCode] Error validating code:`, error);
    return { valid: false, error: error.message || "Validation failed" };
  }
}

/**
 * Mark a booking code as used (after check-in confirmation)
 */
export async function markBookingCodeAsUsed(
  codeId: number,
  ownerId: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const checkinCode = await prisma.checkinCode.findUnique({
      where: { id: codeId },
      select: {
        id: true,
        status: true,
        bookingId: true,
        booking: {
          select: {
            id: true,
            checkIn: true,
            checkOut: true,
            property: {
              select: {
                ownerId: true,
              },
            },
          },
        },
      },
    });

    if (!checkinCode) {
      return { success: false, error: "Code not found" };
    }

    if (checkinCode.booking.property.ownerId !== ownerId) {
      return { success: false, error: "Unauthorized" };
    }

    if (checkinCode.status !== "ACTIVE") {
      return { success: false, error: "Code is not active" };
    }

    const windowStatus = getBookingValidationWindowStatus(
      new Date(checkinCode.booking.checkIn as any),
      new Date(checkinCode.booking.checkOut as any),
      new Date()
    );
    if (!windowStatus.canValidate) {
      return { success: false, error: windowStatus.reason };
    }

    // Update code status and booking status
    await prisma.$transaction(async (tx: any) => {
      await tx.checkinCode.update({
        where: { id: codeId },
        data: {
          status: "USED",
          usedAt: new Date(),
          usedByOwner: true,
        },
      });
      await updateNoLsafBookingStatus(tx, checkinCode.bookingId, "CHECKED_IN");
    });

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Void a booking code (mark as VOID with optional reason)
 * Useful for canceling codes without marking them as used
 */
export async function voidCodeById(codeId: number, reason?: string): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    await prisma.checkinCode.update({
      where: { id: codeId },
      data: {
        status: "VOID",
        voidReason: reason || null,
        voidedAt: new Date(),
      },
    });
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || "Failed to void code" };
  }
}
