import assert from 'node:assert/strict';
import test from 'node:test';
import { roomReadiness, roomAssignmentRequirement } from './lib/nrmsRoomReadiness.ts';
const allocation = (id) => ({ status: 'ACTIVE', roomUnitId: id, roomUnitCode: id ? 'R' + id : null });
test('every room must be assigned, independently of booking source', () => {
  for (const source of ['WALK_IN','NOLSAF','DIRECT','AGENCY']) {
    assert.equal(roomReadiness({source, allocations:[allocation(1),allocation(null)]}).ready, false);
    assert.equal(roomReadiness({source, allocations:[allocation(1),allocation(2)]}).ready, true);
  }
});
test('missing allocations and released rooms cannot count as ready', () => {
  assert.equal(roomReadiness({}).missingAllocation,true);
  assert.equal(roomReadiness({allocations:[{...allocation(1),status:'RELEASED'}]}).ready,false);
  assert.equal(roomReadiness({allocations:[{...allocation(1),roomUnitCode:null}]}).ready,false);
});
test('confirmed marketplace stays can be assigned before the arrival code is consumed', () => {
  const stay={status:'CONFIRMED',bookingId:1,marketplaceBooking:{status:'CONFIRMED',checkInCodeStatus:'ACTIVE'},totalAmount:100,amountPaid:0};
  assert.equal(roomAssignmentRequirement(stay).ready,true);
  assert.equal(roomAssignmentRequirement({...stay,marketplaceBooking:{status:'NEW',checkInCodeStatus:'ACTIVE'}}).ready,false);
});
test('agency settlement does not require a second payment from the traveller', () => {
  const stay={status:'CONFIRMED',totalAmount:100,amountPaid:0};
  assert.equal(roomAssignmentRequirement({...stay,agencySettlement:{settled:true}}).ready,true);
  assert.equal(roomAssignmentRequirement({...stay,agencySettlement:{settled:false}}).ready,false);
});
test('direct stays respect payment coverage including overpayments', () => {
  for (const paid of [100,110]) assert.equal(roomAssignmentRequirement({status:'CONFIRMED',totalAmount:100,amountPaid:paid}).ready,true);
  assert.equal(roomAssignmentRequirement({status:'CONFIRMED',totalAmount:100,amountPaid:50}).kind,'RECORD_PAYMENT');
  assert.equal(roomAssignmentRequirement({status:'CANCELLED',totalAmount:0}).kind,'STATUS');
});
