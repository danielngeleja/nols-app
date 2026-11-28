/** Opt-in real-engine race tests. Never uses DATABASE_URL or the default
 * application client. Run only against a migrated disposable local database:
 * EVENT_HIRE_TEST_DATABASE_URL=mysql://...@127.0.0.1/nolsaf_event_test_...
 * EVENT_HIRE_TEST_DB_ALLOW_WRITE=true
 * No database is created, migrated or truncated by these tests. */
import {randomBytes} from "node:crypto";
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from "vitest";
import prismaPkg from "@prisma/client";
import {PrismaMariaDb} from "@prisma/adapter-mariadb";
import {createEventBlock,createEventRequest,decideEventRequest} from "./eventHireRequests.js";
import {prepareEventCheckout,settleEventCollection} from "./eventHireBookings.js";
import {eventTermsFingerprint,sanitizeEventTerms} from "./eventHire.js";

const connection=process.env.EVENT_HIRE_TEST_DATABASE_URL;
describe.skipIf(!connection)("event-hire MySQL isolation",()=>{
  let db:any,ownerId:number,clientIds:number[],propertyId:number;
  let originalRequestFlag:string|undefined,originalPaymentFlag:string|undefined;
  const terms=sanitizeEventTerms({spaceType:"HALL",eventTypes:["MEETING"],capacitySeated:80,capacityStanding:100,earliestStart:"08:00",latestEnd:"23:00",halfDayPrice:100000,fullDayPrice:200000,depositMode:"PERCENT",depositPercent:25,cleaningFee:10000});
  beforeAll(async()=>{
    const url=new URL(connection!);
    if(process.env.EVENT_HIRE_TEST_DB_ALLOW_WRITE!=="true"||url.protocol!=="mysql:"||!["127.0.0.1","localhost"].includes(url.hostname)||!/^nolsaf_event_test_[a-zA-Z0-9_]+$/.test(url.pathname.slice(1)))throw new Error("Refusing a database that is not an explicitly authorized disposable local event-hire test database.");
    const adapter=new PrismaMariaDb({host:url.hostname,port:Number(url.port||3306),user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),database:url.pathname.slice(1),connectionLimit:6});
    db=new prismaPkg.PrismaClient({adapter});
    originalRequestFlag=process.env.EVENT_HIRE_REQUESTS_ENABLED;originalPaymentFlag=process.env.EVENT_HIRE_PAYMENTS_ENABLED;
    process.env.EVENT_HIRE_REQUESTS_ENABLED="true";process.env.EVENT_HIRE_PAYMENTS_ENABLED="true";
  });
  beforeEach(async()=>{
    const owner=await db.user.create({data:{name:"Event concurrency test owner",role:"OWNER"}});ownerId=owner.id;
    clientIds=[];for(let i=0;i<2;i++){const client=await db.user.create({data:{name:`Event concurrency test client ${i}`,role:"CUSTOMER",phoneVerifiedAt:new Date()}});clientIds.push(client.id);}
    const property=await db.property.create({data:{ownerId,title:"Disposable test hall",type:"HOTEL",status:"APPROVED",rentalMode:"NIGHTLY"}});propertyId=property.id;
    const fingerprint=eventTermsFingerprint(terms);
    await db.propertyEventHire.create({data:{propertyId,status:"APPROVED",terms,termsFingerprint:fingerprint,approvedFingerprint:fingerprint,filledBy:"OWNER",filledByUserId:ownerId,ownerConsentFingerprint:fingerprint,ownerConsentAt:new Date(),ownerConsentVia:"APP"}});
  });
  const input=()=>{
    const day=new Date(Date.now()+3*86400000).toISOString().slice(0,10);
    return{propertyId,startsAt:`${day}T10:00:00+03:00`,endsAt:`${day}T14:00:00+03:00`,eventType:"MEETING",people:50,seating:"SEATED",package:"HALF_DAY",assisted:false};
  };
  afterEach(async()=>{
    if(!propertyId)return;
    const requests=await db.eventHireRequest.findMany({where:{propertyId},select:{id:true}}),ids=requests.map((r:any)=>r.id);
    const bookings=await db.eventHireBooking.findMany({where:{requestId:{in:ids}},select:{id:true,reference:true}}),bookIds=bookings.map((b:any)=>b.id);
    for(const b of bookings)await db.paymentEvent.deleteMany({where:{payload:{path:"$.eventBookingRef",equals:b.reference}}});
    await db.eventHireEvidence.deleteMany({where:{bookingId:{in:bookIds}}});await db.eventHireClaim.deleteMany({where:{bookingId:{in:bookIds}}});await db.eventHireTransfer.deleteMany({where:{bookingId:{in:bookIds}}});await db.eventHireLedgerEntry.deleteMany({where:{bookingId:{in:bookIds}}});await db.eventHireBooking.deleteMany({where:{id:{in:bookIds}}});
    await db.eventHireRequestEvent.deleteMany({where:{requestId:{in:ids}}});await db.eventHireRequest.deleteMany({where:{id:{in:ids}}});await db.eventHireBlock.deleteMany({where:{propertyId}});await db.propertyEventHire.deleteMany({where:{propertyId}});await db.property.delete({where:{id:propertyId}});
    await db.notification.deleteMany({where:{userId:{in:[ownerId,...clientIds]}}});await db.user.deleteMany({where:{id:{in:[ownerId,...clientIds]}}});propertyId=0;
  });
  afterAll(async()=>{
    await db?.$disconnect();
    if(originalRequestFlag===undefined)delete process.env.EVENT_HIRE_REQUESTS_ENABLED;else process.env.EVENT_HIRE_REQUESTS_ENABLED=originalRequestFlag;
    if(originalPaymentFlag===undefined)delete process.env.EVENT_HIRE_PAYMENTS_ENABLED;else process.env.EVENT_HIRE_PAYMENTS_ENABLED=originalPaymentFlag;
  });
  it("exactly one concurrent request can acquire the same venue slot",async()=>{
    const requests=await Promise.all(clientIds.map(userId=>createEventRequest(db,{kind:"CLIENT",userId},input())));
    const outcomes=await Promise.allSettled(requests.map(r=>decideEventRequest(db,{kind:"OWNER",userId:ownerId},r.reference,{version:r.version,action:"CONFIRM"})));
    expect(outcomes.filter(r=>r.status==="fulfilled")).toHaveLength(1);
    expect(await db.eventHireRequest.count({where:{propertyId,status:"READY_TO_PAY"}})).toBe(1);
  });
  it("a concurrent external block and confirmation cannot both win",async()=>{
    const request=await createEventRequest(db,{kind:"CLIENT",userId:clientIds[0]},input());
    const outcomes=await Promise.allSettled([decideEventRequest(db,{kind:"OWNER",userId:ownerId},request.reference,{version:request.version,action:"CONFIRM"}),createEventBlock(db,{kind:"OWNER",userId:ownerId},propertyId,{startsAt:input().startsAt,endsAt:input().endsAt,reason:"EXTERNAL_BOOKING"})]);
    expect(outcomes.filter(r=>r.status==="fulfilled")).toHaveLength(1);
  });
  it("simultaneous provider retries confirm one booking and one collection",async()=>{
    const request=await createEventRequest(db,{kind:"CLIENT",userId:clientIds[0]},input());
    await decideEventRequest(db,{kind:"OWNER",userId:ownerId},request.reference,{version:request.version,action:"CONFIRM"});
    const prepared=await prepareEventCheckout(db,{kind:"CLIENT",userId:clientIds[0]},request.reference);
    const payment={paymentRef:prepared.booking.paymentRef,transactionId:Date.now().toString()+randomBytes(4).readUInt32BE().toString(),amount:prepared.booking.total,currency:"TZS"};
    await Promise.all([settleEventCollection(db,payment),settleEventCollection(db,payment)]);
    expect(await db.eventHireBooking.count({where:{requestId:request.id,status:"CONFIRMED"}})).toBe(1);
    expect(await db.eventHireLedgerEntry.count({where:{bookingId:prepared.booking.id,kind:"COLLECTION"}})).toBe(1);
  });
});
