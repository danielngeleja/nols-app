import { EventHireError } from "./eventHire.js";

export type EventActor = { userId:number;kind:"CLIENT"|"OWNER"|"PARTNER"|"ADMIN";partnerId?:number };
export const EVENT_PENDING_STATUSES=["WAITING_OWNER","OWNER_CONFIRMED","READY_TO_PAY","PAYMENT_PENDING"];

export function effectiveEventStatus(row:any,now=new Date()):string{
  if(EVENT_PENDING_STATUSES.includes(row.status)&&(new Date(row.expiresAt)<=now||new Date(row.startsAt)<=now||(row.holdExpiresAt&&new Date(row.holdExpiresAt)<=now)))return "EXPIRED";
  return row.status;
}
export function eventActorScope(actor:EventActor):any{
  if(actor.kind==="CLIENT")return{clientUserId:actor.userId};
  if(actor.kind==="OWNER")return{property:{ownerId:actor.userId}};
  if(actor.kind==="PARTNER"&&actor.partnerId)return{salesPartnerId:actor.partnerId};
  if(actor.kind==="ADMIN")return{};
  throw new EventHireError("Not found",404,"NOT_FOUND");
}
/** All hold, block and booking allocation paths acquire this same bound lock. */
export async function lockEventProperty(tx:any,propertyId:number){
  await tx.$queryRaw`SELECT id FROM property WHERE id = ${propertyId} FOR UPDATE`;
}
