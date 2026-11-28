import { Router, type RequestHandler, type Response } from "express";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { requireAuth, requireRole, blockImpersonated } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/admin.js";
import { requireAdminFinanceGrant } from "../middleware/financeGrant.js";
import { requireWorkspaceAccess, partnerIdFor } from "../middleware/salesWorkspace.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { rateLimitWithRedis } from "../lib/redisRateLimitStore.js";
import { EventHireError } from "../lib/eventHire.js";
import { agencyGateFailure, loadAgencyGateInput } from "../lib/salesAgency.js";
import { customerRecordReference, matchesCustomerRecordReference } from "../lib/customerBookingReference.js";
import { createEventBlock, eventActorScope, type EventActor } from "../lib/eventHireRequests.js";
import { actOnEventBooking, bookingFor, bookingInclude, bookingScope, eventBookingView, eventFailure, eventPaymentsEnabled, eventTransaction, openDamageClaim, opaque, respondToDamage, bookingEvent } from "../lib/eventHireBookings.js";
import { startEventCard, handleEventCardCallback,eventCallbackSourceAllowed } from "../lib/eventHireCard.js";
import { lockEventProperty } from "../lib/eventHireRequests.js";
const db = prisma as any;
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});
const readLimit = rateLimitWithRedis({
  redisPrefix: "event-operations-read",
  windowMs: 60000,
  limit: 80,
  keyGenerator: (req: any) => `event-operations:${req.user.id}`,
  standardHeaders: true,
  legacyHeaders: false
});
const writeLimit = rateLimitWithRedis({
  redisPrefix: "event-operations-write",
  windowMs: 15 * 60000,
  limit: 20,
  keyGenerator: (req: any) => `event-operations:${req.user.id}`,
  standardHeaders: true,
  legacyHeaders: false
});
function handler(fn: (req: any, res: Response) => Promise<any>): RequestHandler {
  return asyncHandler(async (req, res) => {
    try {
      return await fn(req, res);
    } catch (error: any) {
      if (error instanceof EventHireError) return res.status(error.status).json({
        error: error.message,
        code: error.code
      });
      if (["P2021", "P2022"].includes(error?.code)) {
        // Name the missing table or column (schema names only, no row data)
        // so a schema/migration drift is diagnosable from the log.
        console.warn("[event-hire] database is behind the schema", {
          code: error.code,
          table: error.meta?.table ?? error.meta?.modelName ?? null,
          // Prisma 7 driver adapters nest the column under driverAdapterError.
          column: error.meta?.column ?? error.meta?.driverAdapterError?.cause?.column ?? null,
          cause: error.meta?.driverAdapterError?.cause ?? null,
          message: String(error.message || "").split("\n").filter(Boolean).slice(-2).join(" ").slice(0, 300),
          path: req.path,
        });
      }
      if (["P2021", "P2022"].includes(error?.code)) return res.status(503).json({
        error: "The event workspace needs its database update before it can open.",
        code: "MIGRATION_REQUIRED"
      });
      if (["P2034", "P2028", "P2002"].includes(error?.code)) return res.status(409).json({
        error: "This record changed. Refresh before trying again.",
        code: "CHANGED"
      });
      throw error;
    }
  }) as RequestHandler;
}
const writesOpen: RequestHandler = (_req, res, next) => process.env.EVENT_HIRE_REQUESTS_ENABLED === "true" ? next() : res.status(503).json({
  error: "Event operations have not been activated yet.",
  code: "OPERATIONS_DISABLED"
});
async function propertyFor(req: any, ref: unknown) {
  if (typeof ref !== "string" || ref.length > 80) eventFailure("Choose a property.", "PROPERTY_REQUIRED", 400);
  const properties = await db.property.findMany({
    where: req.eventActor.kind === "OWNER" ? {
      ownerId: req.user.id
    } : {
      id: -1
    },
    select: {
      id: true
    }
  });
  const p = properties.find((p: any) => matchesCustomerRecordReference(ref, "property", p.id));
  if (!p) eventFailure("Property not found.", "NOT_FOUND", 404);
  return p.id;
}
function routerFor(kind: EventActor["kind"]) {
  const router = Router();
  router.use(requireAuth as RequestHandler);
  if (kind === "OWNER") router.use(requireRole("OWNER") as RequestHandler);
  if (kind === "CLIENT") router.use(requireRole("USER") as RequestHandler);
  if (kind === "ADMIN") router.use(requireAdmin as RequestHandler);
  if (kind === "PARTNER") router.use(requireWorkspaceAccess("SALES"));
  router.use(readLimit, asyncHandler(async (req: any, res, next) => {
    req.eventActor = {
      userId: req.user.id,
      kind
    };
    if (kind === "PARTNER") {
      const partnerId = partnerIdFor(req);
      if (!partnerId || agencyGateFailure(await loadAgencyGateInput(db, partnerId))) return res.status(404).json({
        error: "Not found"
      });
      req.eventActor.partnerId = partnerId;
    }
    res.setHeader("Cache-Control", "private, no-store");
    next();
  }) as RequestHandler);
  if (kind === "ADMIN") router.get("/settlements", requireAdminFinanceGrant as RequestHandler, handler(async (req, res) => {
    const parsed = z.object({
      page: z.coerce.number().int().min(1).max(10000).default(1),
      status: z.enum(["REVIEW", "APPROVED", "PAID"]).optional()
    }).strict().safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: "Invalid settlement filters." });
    const where = parsed.data.status ? { status: parsed.data.status } : {};
    const rows = await db.eventHireTransfer.findMany({
      where, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (parsed.data.page - 1) * 40, take: 41,
      include: { booking: { select: { reference: true, venueTitle: true, status: true, depositStatus: true, request: { select: { startsAt: true } } } } }
    });
    const visible = rows.slice(0, 40);
    const users = [...new Set(visible.map((r: any) => r.payeeUserId))];
    const [payees, accounts, disbursements] = visible.length ? await Promise.all([
      db.user.findMany({ where: { id: { in: users } }, select: { id: true, fullName: true, name: true } }),
      db.payoutAccount.findMany({ where: { userId: { in: users }, isActive: true, isVerified: true }, select: { userId: true } }),
      db.disbursement.findMany({ where: { sourceType: "EVENT_HIRE", sourceId: { in: visible.map((r: any) => r.id) } }, orderBy: { id: "desc" }, select: { id: true, sourceId: true, status: true, externalReferenceId: true, paidAt: true } })
    ]) : [[], [], []];
    return res.json({ hasMore: rows.length > 40, transfers: visible.map((r: any) => {
      const payee = payees.find((u: any) => u.id === r.payeeUserId);
      return {
        reference: r.reference, sourceId: r.id, kind: r.kind, amount: r.amount,
        status: r.status, paidAt: r.paidAt, createdAt: r.createdAt,
        // The event time lives on the request, not the booking row.
        booking: { reference: r.booking.reference, venueTitle: r.booking.venueTitle, status: r.booking.status, depositStatus: r.booking.depositStatus, startsAt: r.booking.request?.startsAt ?? null }, payeeName: payee?.fullName || payee?.name || "NoLSAF account",
        verifiedDestinationOnFile: accounts.some((a: any) => a.userId === r.payeeUserId),
        disbursement: disbursements.find((d: any) => d.sourceId === r.id) || null
      };
    }) });
  }));
  router.get("/workspace", handler(async (req, res) => {
    const propertyId = req.query.venue ? await propertyFor(req, req.query.venue) : null;
    const scope = {
      ...bookingScope(req.eventActor),
      ...(propertyId ? {
        request: {
          propertyId
        }
      } : {})
    };
    const [groups, paid, held, transfers, pendingRequests] = await Promise.all([db.eventHireBooking.groupBy({
      by: ["status"],
      where: scope,
      _count: {
        _all: true
      }
    }), db.eventHireLedgerEntry.aggregate({
      where:{booking:scope,kind:{in:["COLLECTION","EXTRA_COLLECTION"]}},
      _sum:{amount:true}
    }), db.eventHireLedgerEntry.aggregate({
      where: {
        booking: scope,
        kind: {
          in: ["DEPOSIT_HELD", "DEPOSIT_RELEASED"]
        }
      },
      _sum: {
        amount: true
      }
    }), db.eventHireTransfer.groupBy({
      by: ["status"],
      where: {
        booking: scope,
        ...(kind === "ADMIN" ? {} : {
          payeeUserId: req.user.id
        })
      },
      _sum: {
        amount: true
      }
    }), db.eventHireRequest.count({
      where: {
        ...eventActorScope(req.eventActor),
        ...(propertyId ? {
          propertyId
        } : {}),
        status: {
          in: ["WAITING_OWNER", "OWNER_CONFIRMED", "READY_TO_PAY", "PAYMENT_PENDING"]
        },
        expiresAt: {
          gt: new Date()
        }
      }
    })]);
    return res.json({
      enabled: process.env.EVENT_HIRE_REQUESTS_ENABLED === "true",
      paymentsEnabled: eventPaymentsEnabled(),
      statuses: Object.fromEntries(groups.map((g: any) => [g.status, g._count._all])),
      pendingRequests,
      collected: paid._sum.amount ?? 0,
      depositHeld: held._sum.amount ?? 0,
      settlementPending: transfers.filter((t: any) => ["REVIEW", "APPROVED"].includes(t.status)).reduce((n: number, t: any) => n + (t._sum.amount ?? 0), 0),
      settled: transfers.filter((t: any) => t.status === "PAID").reduce((n: number, t: any) => n + (t._sum.amount ?? 0), 0)
    });
  }));
  router.get("/bookings", handler(async (req, res) => {
    const parsed = z.object({
      page: z.coerce.number().int().min(1).max(10000).default(1),
      status: z.enum(["CONFIRMED", "COMPLETED", "CANCELLED", "PAYMENT_PENDING", "PAYMENT_REVIEW", "EXPIRED"]).optional(),
      upcoming: z.literal("true").optional(),
      venue: z.string().max(80).optional()
    }).strict().safeParse(req.query);
    if (!parsed.success) return res.status(400).json({
      error: "Invalid booking filters."
    });
    const query = parsed.data,
      propertyId = query.venue ? await propertyFor(req, query.venue) : null;
    if (query.upcoming && (query.page !== 1 || (query.status && query.status !== "CONFIRMED"))) return res.status(400).json({ error: "Upcoming events use the first page of confirmed bookings." });
    const rows = await db.eventHireBooking.findMany({
      where: {
        ...bookingScope(req.eventActor),
        ...(query.status ? {
          status: query.status
        } : {}),
        ...(query.upcoming ? { status: "CONFIRMED", AND: [{ request: { endsAt: { gt: new Date() } } }] } : {}),
        ...(propertyId ? {
          request: {
            ...eventActorScope(req.eventActor),
            propertyId
          }
        } : {})
      },
      include: bookingInclude,
      orderBy: query.upcoming ? [{ request: { startsAt: "asc" } }, { id: "asc" }] : [{
        createdAt: "desc"
      }, {
        id: "desc"
      }],
      skip: (query.page - 1) * 40,
      take: query.upcoming ? 6 : 41
    });
    return res.json({
      bookings: rows.slice(0, query.upcoming ? 5 : 40).map((b: any) => eventBookingView(b, req.eventActor)),
      hasMore: rows.length > (query.upcoming ? 5 : 40),
      page: query.page
    });
  }));
  router.get("/calendar", handler(async (req, res) => {
    const parsed = z.object({
      from: z.string().datetime({
        offset: true
      }),
      to: z.string().datetime({
        offset: true
      }),
      venue: z.string().max(80).optional()
    }).strict().safeParse(req.query);
    if (!parsed.success) return res.status(400).json({
      error: "Choose the calendar range."
    });
    const from = new Date(parsed.data.from),
      to = new Date(parsed.data.to);
    const propertyId = parsed.data.venue ? await propertyFor(req, parsed.data.venue) : null;
    if (to <= from || to.getTime() - from.getTime() > 93 * 86400000) return res.status(400).json({
      error: "Choose up to three months."
    });
    const window = {
      startsAt: {
        lt: to
      },
      endsAt: {
        gt: from
      },
      ...(propertyId ? {
        propertyId
      } : {})
    };
    const bookings = await db.eventHireBooking.findMany({
      where: {
        ...bookingScope(req.eventActor),
        request: {
          ...(kind === "OWNER" ? {} : eventActorScope(req.eventActor)),
          ...window
        },
        OR: [{
          status: {
            in: ["CONFIRMED", "COMPLETED"]
          }
        }, {
          status: "PAYMENT_PENDING",
          checkoutExpiresAt: {
            gt: new Date()
          }
        }]
      },
      include: {
        request: {
          include: {
            property: {
              select: {
                title: true
              }
            }
          }
        }
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 500
    });
    const blocks = kind === "OWNER" ? await db.eventHireBlock.findMany({
      where: {
        property: {
          ownerId: req.user.id
        },
        cancelledAt: null,
        ...window
      },
      include: {
        property: {
          select: {
            title: true
          }
        }
      },
      orderBy: {
        startsAt: "asc"
      },
      take: 500
    }) : [];
    const holds = await db.eventHireRequest.findMany({
      where: {
        ...eventActorScope(req.eventActor),
        ...window,
        status: {
          in: ["OWNER_CONFIRMED", "READY_TO_PAY"]
        },
        holdExpiresAt: {
          gt: new Date()
        }
      },
      select: {
        reference: true,
        startsAt: true,
        endsAt: true,
        status: true,
        holdExpiresAt: true,
        property: {
          select: {
            title: true
          }
        }
      },
      take: 500
    });
    return res.json({
      events: [...bookings.map((b: any) => ({
        reference: b.reference,
        title: b.request.property.title,
        startsAt: b.request.startsAt,
        endsAt: b.request.endsAt,
        status: b.status,
        kind: "BOOKING"
      })), ...blocks.map((b: any) => ({
        reference: b.reference,
        title: b.property.title,
        startsAt: b.startsAt,
        endsAt: b.endsAt,
        status: b.reason,
        kind: "BLOCK"
      })), ...holds.map((h: any) => ({
        reference: h.reference,
        title: h.property.title,
        startsAt: h.startsAt,
        endsAt: h.endsAt,
        status: h.status,
        kind: "HOLD",
        expiresAt: h.holdExpiresAt
      }))].sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()),
      truncated: bookings.length === 500 || blocks.length === 500 || holds.length === 500
    });
  }));
  router.get("/bookings/:ref", handler(async (req, res) => {
    const b = await bookingFor(db, req.params.ref, req.eventActor);
    const contacts=kind==="ADMIN"?{
      ownerContact:await db.user.findUnique({where:{id:b.ownerId},select:{name:true,fullName:true,phone:true,email:true}}),
      clientContact:await db.user.findUnique({where:{id:b.request.clientUserId},select:{name:true,fullName:true,phone:true,email:true}}),
    }:{};
    const entries = await db.eventHireLedgerEntry.findMany({
      where: {
        bookingId: b.id,
        ...(["CLIENT","PARTNER"].includes(kind) ? {
          kind: {
            in: ["COLLECTION", "DEPOSIT_HELD", "DEPOSIT_REFUND", "CANCELLATION_REFUND"]
          }
        } : {})
      },
      select: {
        kind: true,
        amount: true,
        createdAt: true
      },
      orderBy: {
        createdAt: "asc"
      }
    });
    const history = await db.eventHireRequestEvent.findMany({
      where: {
        requestId: b.requestId
      },
      select: {
        action: true,
        createdAt: true,
        details: kind === "ADMIN"
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 100
    });
    return res.json({
      ...eventBookingView(b, req.eventActor),
      ...contacts,
      entries,
      history,
      venueRef: customerRecordReference("property", b.request.propertyId)
    });
  }));
  router.post("/bookings/:ref/act", blockImpersonated as RequestHandler, writeLimit, writesOpen, ((req: any, res: any, next: any) => kind === "ADMIN" ? requireAdminFinanceGrant(req, res, next) : next()) as RequestHandler, handler(async (req, res) => res.json(eventBookingView(await actOnEventBooking(db, req.eventActor, req.params.ref, req.body), req.eventActor))));
  router.post("/bookings/:ref/claim", blockImpersonated as RequestHandler, writeLimit, writesOpen, handler(async (req, res) => {
    const c = await openDamageClaim(db, req.eventActor, req.params.ref, req.body);
    return res.status(201).json({
      reference: c.reference
    });
  }));
  router.post("/bookings/:ref/respond", blockImpersonated as RequestHandler, writeLimit, writesOpen, handler(async (req, res) => {
    await respondToDamage(db, req.eventActor, req.params.ref, req.body);
    return res.json({
      ok: true
    });
  }));
  router.get("/bookings/:ref/evidence/:asset", handler(async (req, res) => {
    if(kind==="PARTNER")return res.status(403).json({error:"Condition evidence is limited to the booking parties and NoLSAF reviewers."});
    const b = await bookingFor(db, req.params.ref, req.eventActor);
    const e = b.evidence.find((x: any) => x.reference === req.params.asset);
    if (!e) return res.status(404).json({
      error: "Evidence not found."
    });
    const url = cloudinary.utils.private_download_url(e.publicId, e.format, {
      type: "authenticated",
      resource_type: "image",
      expires_at: Math.floor(Date.now() / 1000) + 300
    } as any);
    return res.redirect(302, url);
  }));
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 8 * 1024 * 1024,
      files: 1,
      fields: 1
    }
  });
  router.post("/bookings/:ref/evidence", blockImpersonated as RequestHandler, writeLimit, writesOpen, asyncHandler(async (req: any, res, next) => {
    if (!["OWNER", "CLIENT"].includes(kind)) return res.status(403).json({
      error: "Party account required."
    });
    try {
      await bookingFor(db, req.params.ref, req.eventActor);
    } catch (error) {
      return next(error);
    }
    upload.single("file")(req, res, (error: any) => error ? res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
      error: "Upload one JPEG, PNG or WebP image up to 8 MB."
    }) : next());
  }) as RequestHandler, handler(async (req, res) => {
    const kindResult = z.enum(["BEFORE", "AFTER", "RECEIPT", "OTHER"]).safeParse(req.body?.kind);
    const file = req.file;
    if (!kindResult.success || !file || !["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) return res.status(400).json({
      error: "Upload a JPEG, PNG or WebP image."
    });
    const b = await bookingFor(db, req.params.ref, req.eventActor),
      now = new Date();
    if (!b.paidAt || !["CONFIRMED", "COMPLETED"].includes(b.status) || b.transfers.some((t: any) => !t.kind.startsWith("EXTRA_REFUND_")) || b.evidence.filter((e:any)=>e.uploadedById===req.user.id).length >= 24) return res.status(409).json({
      error: "Evidence uploads are closed for this booking."
    });
    if (kindResult.data === "BEFORE" && now >= b.request.startsAt || kindResult.data === "AFTER" && now < b.request.endsAt) return res.status(409).json({
      error: "Before photos must be uploaded before the event; after photos after it ends."
    });
    if (!process.env.CLOUDINARY_API_SECRET) return res.status(503).json({
      error: "Private evidence storage is not configured."
    });
    const reference = opaque("eev");
    const asset: any = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream({
        resource_type: "image",
        type: "authenticated",
        folder: "nolsaf/event-evidence",
        public_id: reference,
        allowed_formats: ["jpg", "jpeg", "png", "webp"],
        overwrite: false
      }, (error, result) => error ? reject(error) : resolve(result));
      stream.end(file.buffer);
    });
    try {
      await eventTransaction(db, async tx => {
        await lockEventProperty(tx, b.request.propertyId);
        const current = await bookingFor(tx, b.reference, req.eventActor);
        if (current.evidence.filter((e:any)=>e.uploadedById===req.user.id).length >= 24 || current.transfers.some((t: any) => !t.kind.startsWith("EXTRA_REFUND_")) || !["CONFIRMED", "COMPLETED"].includes(current.status)) eventFailure("Evidence uploads are closed.");
        if (kindResult.data === "BEFORE" && new Date() >= current.request.startsAt) eventFailure("Before-condition photos must be recorded before the event starts.");
        await tx.eventHireEvidence.create({
          data: {
            reference,
            bookingId: b.id,
            uploadedById: req.user.id,
            kind: kindResult.data,
            publicId: asset.public_id,
            format: asset.format
          }
        });
        await tx.eventHireBooking.update({where:{id:b.id},data:{version:{increment:1}}});
        await bookingEvent(tx, b, req.eventActor, "EVIDENCE_UPLOADED", {
          reference,
          kind: kindResult.data
        });
      });
    } catch (error) {
      await cloudinary.uploader.destroy(asset.public_id, {
        type: "authenticated",
        resource_type: "image"
      }).catch(() => undefined);
      throw error;
    }
    return res.status(201).json({
      reference,
      kind: kindResult.data
    });
  }));
  if (kind === "CLIENT") router.post("/checkout", blockImpersonated as RequestHandler, writeLimit, writesOpen, handler(async (req, res) => {
    const parsed = z.object({
      requestRef: z.string().regex(/^er_[A-Za-z0-9_-]{32}$/),
      consent: z.literal(true)
    }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({
      error: "Accept the approved event quote before paying."
    });
    return res.json(await startEventCard(db, req.eventActor, parsed.data.requestRef));
  }));
  if (kind === "OWNER") router.post("/blocks", blockImpersonated as RequestHandler, writeLimit, writesOpen, handler(async (req, res) => {
    const parsed = z.object({
      venue: z.string().max(80),
      startsAt: z.string(),
      endsAt: z.string(),
      reason: z.enum(["EXTERNAL_BOOKING", "MAINTENANCE", "UNAVAILABLE"])
    }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({
      error: "Check the blocked time."
    });
    const {
      venue,
      ...body
    } = parsed.data;
    const id = await propertyFor(req, venue);
    const block = await createEventBlock(db, req.eventActor, id, body);
    return res.status(201).json({
      reference: block.reference
    });
  }));
  if (kind === "OWNER") router.delete("/blocks/:ref", blockImpersonated as RequestHandler, writeLimit, writesOpen, handler(async (req, res) => {
    if (!/^eb_[A-Za-z0-9_-]{32}$/.test(req.params.ref)) return res.status(404).json({
      error: "Not found"
    });
    const result = await db.eventHireBlock.updateMany({
      where: {
        reference: req.params.ref,
        property: {
          ownerId: req.user.id
        },
        cancelledAt: null
      },
      data: {
        cancelledAt: new Date(),
        cancelledById: req.user.id
      }
    });
    return result.count ? res.status(204).end() : res.status(404).json({
      error: "Not found"
    });
  }));
  return router;
}
export const ownerEventOperationsRouter = routerFor("OWNER");
export const customerEventOperationsRouter = routerFor("CLIENT");
export const adminEventOperationsRouter = routerFor("ADMIN");
export const salesEventOperationsRouter = routerFor("PARTNER");
export const eventCardCallbackRouter = Router();
const parseEventCallback=multer({limits:{fieldSize:100000,fields:2,files:0}}).none();
eventCardCallbackRouter.post("/card-callback", rateLimitWithRedis({
  redisPrefix: "event-card-callback",
  windowMs: 60000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false
}),((req,res,next)=>parseEventCallback(req,res,error=>error?res.status(400).json({error:"Invalid callback body."}):next())) as RequestHandler,asyncHandler(async(req,res)=>{
  try{
    if(!eventCallbackSourceAllowed({ip:req.ip,headers:req.headers}))return res.status(403).json({error:"Callback source is not authorized."});
    const result=await handleEventCardCallback(db,req.query.ref,req.query.cap,req.body?.UCFCallback);
    return res.json({ok:true,reference:result.reference,status:result.status});
  }catch(error:any){
    if(error instanceof EventHireError)return res.status(error.status).json({error:error.message,code:error.code});
    // Do not pass a capability-bearing URL/cipher to generic diagnostics.
    console.error("[event-card-callback] persistence failed",typeof error?.code==="string"?error.code:"UNKNOWN");
    return res.status(503).json({error:"Payment reconciliation is temporarily unavailable. The provider should retry."});
  }
}) as RequestHandler);
