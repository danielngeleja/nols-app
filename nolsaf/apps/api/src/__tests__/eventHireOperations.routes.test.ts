import express from "express";
import request from "supertest";
import {beforeEach,describe,expect,it,vi} from "vitest";
const h=vi.hoisted(()=>({user:{id:10,role:"USER"} as any,partnerId:30 as number|null,agencyFailure:null as string|null,finance:false,
  act:vi.fn(),claim:vi.fn(),respond:vi.fn(),card:vi.fn(),callback:vi.fn(),
  db:{eventHireBooking:{findFirst:vi.fn(),findMany:vi.fn(),groupBy:vi.fn(),aggregate:vi.fn()},eventHireRequest:{count:vi.fn(),findMany:vi.fn()},eventHireLedgerEntry:{findMany:vi.fn(),aggregate:vi.fn()},eventHireRequestEvent:{findMany:vi.fn()},eventHireTransfer:{groupBy:vi.fn(),findMany:vi.fn()},eventHireBlock:{findMany:vi.fn()},property:{findMany:vi.fn()},user:{findMany:vi.fn()},payoutAccount:{findMany:vi.fn()},disbursement:{findMany:vi.fn()}},
  privateUrl:vi.fn(),upload:vi.fn(),
}));
vi.mock("@nolsaf/prisma",()=>({prisma:h.db}));
vi.mock("../lib/redis.js",()=>({getRedis:()=>null}));
vi.mock("../lib/redisRateLimitStore.js",()=>({rateLimitWithRedis:()=> (_req:any,_res:any,next:any)=>next()}));
vi.mock("../middleware/auth.js",()=>({requireAuth:(req:any,res:any,next:any)=>{if(!h.user)return res.status(401).json({error:"Unauthorized"});req.user=h.user;next();},requireRole:(role:string)=>(req:any,res:any,next:any)=>req.user.role===role?next():res.status(403).json({error:"Forbidden"}),blockImpersonated:(req:any,res:any,next:any)=>req.user.imp?res.status(403).json({error:"Impersonation blocked"}):next()}));
vi.mock("../middleware/salesWorkspace.js",()=>({requireWorkspaceAccess:()=> (_req:any,res:any,next:any)=>h.partnerId?next():res.status(404).json({error:"Not found"}),partnerIdFor:()=>h.partnerId}));
vi.mock("../middleware/financeGrant.js",()=>({requireAdminFinanceGrant:(_req:any,res:any,next:any)=>h.finance?next():res.status(403).json({error:"OTP required",require2fa:true})}));
vi.mock("../lib/salesAgency.js",()=>({loadAgencyGateInput:async()=>({failure:h.agencyFailure}),agencyGateFailure:(g:any)=>g.failure}));
vi.mock("../lib/eventHireBookings.js",async original=>({...await original<any>(),actOnEventBooking:h.act,openDamageClaim:h.claim,respondToDamage:h.respond}));
vi.mock("../lib/eventHireCard.js",()=>({startEventCard:h.card,handleEventCardCallback:h.callback,eventCallbackSourceAllowed:()=>true}));
vi.mock("../lib/customerBookingReference.js",()=>({customerRecordReference:(_kind:string,id:number)=>`pp_${id}`,matchesCustomerRecordReference:(ref:string,_kind:string,id:number)=>ref===`pp_${id}`}));
vi.mock("cloudinary",()=>({v2:{config:vi.fn(),utils:{private_download_url:h.privateUrl},uploader:{upload_stream:h.upload}}}));
import {csrfProtection} from "../middleware/csrf.js";
import {EventHireError} from "../lib/eventHire.js";
import {adminEventOperationsRouter,customerEventOperationsRouter,eventCardCallbackRouter,ownerEventOperationsRouter,salesEventOperationsRouter} from "../routes/eventHire.operations.js";
const app=express();app.use(express.json());app.use(csrfProtection);app.use("/api/owner/event-hire",ownerEventOperationsRouter);app.use("/api/customer/event-hire",customerEventOperationsRouter);app.use("/api/admin/event-hire/operations",adminEventOperationsRouter);app.use("/api/sales/event-hire",salesEventOperationsRouter);app.use("/api/event-hire",eventCardCallbackRouter);app.use((error:any,_req:any,res:any,_next:any)=>res.status(error.status||500).json({error:error.message}));
const ref=`ebk_${"a".repeat(32)}`,asset=`eev_${"c".repeat(32)}`;
function booking(){return{reference:ref,version:1,id:1,requestId:7,ownerId:20,status:"CONFIRMED",total:141000,deposit:25000,ownerDue:100000,fee:16000,callbackTokenHash:"secret-hash",providerTransactionId:"secret-bank-reference",request:{clientUserId:10,propertyId:3,property:{title:"Venue",ownerId:20}},claims:[],transfers:[],evidence:[{reference:asset,publicId:"secret-private-asset-id",format:"jpg",kind:"BEFORE",createdAt:new Date(),uploadedById:20}]};}
beforeEach(()=>{vi.clearAllMocks();h.user={id:10,role:"USER"};h.partnerId=30;h.agencyFailure=null;h.finance=false;process.env.EVENT_HIRE_REQUESTS_ENABLED="true";h.db.eventHireBooking.findFirst.mockResolvedValue(null);h.db.eventHireBooking.findMany.mockResolvedValue([]);h.db.eventHireBooking.groupBy.mockResolvedValue([]);h.db.eventHireBooking.aggregate.mockResolvedValue({_sum:{},_count:{_all:0}});h.db.eventHireLedgerEntry.aggregate.mockResolvedValue({_sum:{amount:0}});h.db.eventHireTransfer.groupBy.mockResolvedValue([]);h.db.eventHireRequest.count.mockResolvedValue(0);h.db.eventHireRequest.findMany.mockResolvedValue([]);h.db.eventHireBlock.findMany.mockResolvedValue([]);h.db.eventHireLedgerEntry.findMany.mockResolvedValue([]);h.db.eventHireRequestEvent.findMany.mockResolvedValue([]);h.db.property.findMany.mockResolvedValue([{id:3}]);h.privateUrl.mockReturnValue("https://res.cloudinary.com/private-signed-image");});

describe("event operating workspace access",()=>{
  it.each(["owner/event-hire","customer/event-hire","sales/event-hire","admin/event-hire/operations"])("requires authentication for %s",async path=>{h.user=null;expect((await request(app).get(`/api/${path}/workspace`)).status).toBe(401);expect(h.db.eventHireBooking.groupBy).not.toHaveBeenCalled();});
  it.each(["owner/event-hire","admin/event-hire/operations"])("denies a client entry to %s",async path=>{expect((await request(app).get(`/api/${path}/workspace`)).status).toBe(403);});
  it("rechecks the Agency Desk capability on every read",async()=>{h.agencyFailure="REVOKED";expect((await request(app).get("/api/sales/event-hire/bookings")).status).toBe(404);expect(h.db.eventHireBooking.findMany).not.toHaveBeenCalled();});
  it.each([["owner","OWNER",{ownerId:10}],["customer","USER",{request:{clientUserId:10}}],["sales","USER",{request:{salesPartnerId:30}}]])("scopes %s bookings and details to the authenticated actor",async(area,role,scope)=>{h.user.role=role;expect((await request(app).get(`/api/${area}/event-hire/bookings`)).status).toBe(200);expect(h.db.eventHireBooking.findMany).toHaveBeenCalledWith(expect.objectContaining({where:scope}));expect((await request(app).get(`/api/${area}/event-hire/bookings/${ref}`)).status).toBe(404);expect(h.db.eventHireBooking.findFirst).toHaveBeenCalledWith(expect.objectContaining({where:{reference:ref,...scope}}));});
  it("does not accept a guessed numeric booking id",async()=>{expect((await request(app).get("/api/customer/event-hire/bookings/1")).status).toBe(404);expect(h.db.eventHireBooking.findFirst).not.toHaveBeenCalled();});
  it("retains read access to paid records while new operations are disabled",async()=>{delete process.env.EVENT_HIRE_REQUESTS_ENABLED;expect((await request(app).get("/api/customer/event-hire/workspace")).status).toBe(200);expect((await request(app).post(`/api/customer/event-hire/bookings/${ref}/act`).send({action:"COMPLETE",version:1})).status).toBe(503);expect(h.act).not.toHaveBeenCalled();});
  it("returns an explicit migration requirement instead of fabricated zero figures",async()=>{h.db.eventHireBooking.groupBy.mockRejectedValueOnce({code:"P2021"});const r=await request(app).get("/api/customer/event-hire/workspace");expect(r.status).toBe(503);expect(r.body.code).toBe("MIGRATION_REQUIRED");});
  it("never serializes callback capabilities, bank references, private asset keys, or hidden fees to a client",async()=>{h.db.eventHireBooking.findFirst.mockResolvedValue(booking());const r=await request(app).get(`/api/customer/event-hire/bookings/${ref}`);expect(r.status).toBe(200);expect(JSON.stringify(r.body)).not.toContain("secret-");expect(r.body.ownerDue).toBeUndefined();expect(r.body.fee).toBeUndefined();expect(h.db.eventHireLedgerEntry.findMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({kind:{in:["COLLECTION","DEPOSIT_HELD","DEPOSIT_REFUND","CANCELLATION_REFUND"]}})}));});
  it("refuses a venue filter outside the owner's properties",async()=>{h.user.role="OWNER";expect((await request(app).get("/api/owner/event-hire/bookings?venue=pp_999")).status).toBe(404);expect(h.db.eventHireBooking.findMany).not.toHaveBeenCalled();});
  it("keeps private reads out of shared caches",async()=>{const r=await request(app).get("/api/customer/event-hire/bookings");expect(r.headers["cache-control"]).toContain("private, no-store");});
});
describe("booking and money mutations",()=>{
  it("blocks impersonated sessions before any booking mutation",async()=>{h.user.imp=true;expect((await request(app).post(`/api/customer/event-hire/bookings/${ref}/act`).send({version:1,action:"COMPLETE"})).status).toBe(403);expect(h.act).not.toHaveBeenCalled();});
  it("requires finance re-authentication for admin decisions",async()=>{h.user.role="ADMIN";const r=await request(app).post(`/api/admin/event-hire/operations/bookings/${ref}/act`).send({version:1,action:"APPROVE_TRANSFER"});expect(r.status).toBe(403);expect(r.body.require2fa).toBe(true);expect(h.act).not.toHaveBeenCalled();});
  it("a finance-granted admin decision still passes the actual authenticated actor to the state machine",async()=>{h.user={id:40,role:"ADMIN"};h.finance=true;h.act.mockResolvedValue(booking());const r=await request(app).post(`/api/admin/event-hire/operations/bookings/${ref}/act`).send({version:1,action:"COMPLETE"});expect(r.status).toBe(200);expect(h.act).toHaveBeenCalledWith(h.db,{kind:"ADMIN",userId:40},ref,{version:1,action:"COMPLETE"});});
  it("does not exempt checkout from cookie CSRF protection",async()=>{const r=await request(app).post("/api/customer/event-hire/checkout").set("Cookie","nolsaf_token=session").set("Origin","https://untrusted.example").set("Sec-Fetch-Site","cross-site").send({});expect(r.status).toBe(403);expect(h.card).not.toHaveBeenCalled();});
  it("rejects client-controlled checkout amounts and identities",async()=>{expect((await request(app).post("/api/customer/event-hire/checkout").send({requestRef:`er_${"a".repeat(32)}`,consent:true,amount:1,clientUserId:999})).status).toBe(400);expect(h.card).not.toHaveBeenCalled();});
  it("forwards only a request reference and authenticated client to checkout",async()=>{h.card.mockResolvedValue({checkoutUrl:"https://pay.example.test"});const r=await request(app).post("/api/customer/event-hire/checkout").send({requestRef:`er_${"a".repeat(32)}`,consent:true});expect(r.status).toBe(200);expect(h.card).toHaveBeenCalledWith(h.db,{kind:"CLIENT",userId:10},`er_${"a".repeat(32)}`);});
});

describe("admin event settlement queue", () => {
  const path = "/api/admin/event-hire/operations/settlements";
  it("denies customers and requires a fresh finance grant for admins", async () => {
    expect((await request(app).get(path)).status).toBe(403);
    h.user.role = "ADMIN";
    expect((await request(app).get(path)).body.require2fa).toBe(true);
    expect(h.db.eventHireTransfer.findMany).not.toHaveBeenCalled();
  });
  it("rejects unbounded and user-controlled settlement filters", async () => {
    h.user.role = "ADMIN"; h.finance = true;
    for (const query of ["?page=0", "?page=10001", "?payeeUserId=999", "?status=ANY"]) {
      expect((await request(app).get(path + query)).status).toBe(400);
    }
    expect(h.db.eventHireTransfer.findMany).not.toHaveBeenCalled();
  });
  it("links the real event transfer to its payee and latest disbursement without returning account details", async () => {
    h.user.role = "ADMIN"; h.finance = true;
    h.db.eventHireTransfer.findMany.mockResolvedValue([{ id: 5, reference: "eft_test", kind: "OWNER_PAYOUT", amount: 100000, status: "APPROVED", payeeUserId: 20, booking: { reference: ref, venueTitle: "Hall" } }]);
    h.db.user.findMany.mockResolvedValue([{ id: 20, fullName: "Venue owner" }]);
    h.db.payoutAccount.findMany.mockResolvedValue([{ userId: 20 }]);
    h.db.disbursement.findMany.mockResolvedValue([{ id: 9, sourceId: 5, status: "PROCESSING", externalReferenceId: "E123" }]);
    const r = await request(app).get(path + "?status=APPROVED&page=2");
    expect(r.status).toBe(200);
    expect(r.headers["cache-control"]).toContain("private, no-store");
    expect(r.body.transfers[0]).toMatchObject({ sourceId: 5, payeeName: "Venue owner", verifiedDestinationOnFile: true, disbursement: { status: "PROCESSING" } });
    expect(h.db.eventHireTransfer.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: "APPROVED" }, skip: 40, take: 41 }));
    expect(h.db.disbursement.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { sourceType: "EVENT_HIRE", sourceId: { in: [5] } } }));
    expect(h.db.payoutAccount.findMany).toHaveBeenCalledWith(expect.objectContaining({ select: { userId: true } }));
  });
  it("does not query recipients or accounts for an empty queue", async () => {
    h.user.role = "ADMIN"; h.finance = true;
    h.db.eventHireTransfer.findMany.mockResolvedValue([]);
    const r = await request(app).get(path);
    expect(r.body).toEqual({ hasMore: false, transfers: [] });
    expect(h.db.payoutAccount.findMany).not.toHaveBeenCalled();
  });
});

describe("chronological upcoming bookings", () => {
  it("keeps the authenticated owner scope while selecting only future confirmed events", async () => {
    h.user.role = "OWNER";
    const r = await request(app).get("/api/owner/event-hire/bookings?upcoming=true");
    expect(r.status).toBe(200);
    expect(h.db.eventHireBooking.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { ownerId: 10, status: "CONFIRMED", AND: [{ request: { endsAt: { gt: expect.any(Date) } } }] },
      orderBy: [{ request: { startsAt: "asc" } }, { id: "asc" }], take: 6
    }));
  });
  it.each(["upcoming=false", "upcoming=true&page=2", "upcoming=true&status=CANCELLED"])("rejects incompatible upcoming filters: %s", async query => {
    expect((await request(app).get(`/api/customer/event-hire/bookings?${query}`)).status).toBe(400);
    expect(h.db.eventHireBooking.findMany).not.toHaveBeenCalled();
  });
});
describe("private evidence and callback boundary",()=>{
  it("does not sign a private image for someone who cannot open the booking",async()=>{const r=await request(app).get(`/api/customer/event-hire/bookings/${ref}/evidence/${asset}`);expect(r.status).toBe(404);expect(h.privateUrl).not.toHaveBeenCalled();});
  it("creates only a short-lived authenticated download for an attached asset",async()=>{h.db.eventHireBooking.findFirst.mockResolvedValue(booking());const r=await request(app).get(`/api/customer/event-hire/bookings/${ref}/evidence/${asset}`);expect(r.status).toBe(302);expect(h.privateUrl).toHaveBeenCalledWith("secret-private-asset-id","jpg",expect.objectContaining({type:"authenticated",resource_type:"image",expires_at:expect.any(Number)}));});
  it("a valid booking does not authorize someone else's unattached evidence",async()=>{h.db.eventHireBooking.findFirst.mockResolvedValue(booking());const r=await request(app).get(`/api/customer/event-hire/bookings/${ref}/evidence/eev_${"x".repeat(32)}`);expect(r.status).toBe(404);expect(h.privateUrl).not.toHaveBeenCalled();});
  it("partners cannot upload condition evidence on behalf of a party",async()=>{expect((await request(app).post(`/api/sales/event-hire/bookings/${ref}/evidence`)).status).toBe(403);expect(h.upload).not.toHaveBeenCalled();});
  it("the callback has no public booking capability without its provider proof",async()=>{h.user=null;h.callback.mockRejectedValue(new EventHireError("Invalid callback",403,"CALLBACK_REJECTED"));const r=await request(app).post("/api/event-hire/card-callback?ref=guessed&cap=wrong").send({UCFCallback:"untrusted"});expect(r.status).toBe(403);expect(h.act).not.toHaveBeenCalled();});
});
