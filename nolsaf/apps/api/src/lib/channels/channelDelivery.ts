import { queueBookingComPropertyAriUpdates } from "./bookingComDelivery.js";
import { queueExpediaPropertyAriUpdates } from "./expediaDelivery.js";

/** Queue every active API channel inside the caller's inventory transaction. */
export async function queuePropertyChannelAriUpdates(client: any, propertyId: number, reason: string, from = new Date(), months = 12): Promise<number> {
  const [bookingCom, expedia] = await Promise.all([
    queueBookingComPropertyAriUpdates(client, propertyId, reason, from, months),
    queueExpediaPropertyAriUpdates(client, propertyId, reason, from, months),
  ]);
  return bookingCom + expedia;
}
