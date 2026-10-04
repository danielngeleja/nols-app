const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), test = require('node:test'), ts = require('typescript'), React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const compile = text => ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const policy = { exports: {} };
vm.runInNewContext(compile(fs.readFileSync('lib/nrmsRoomReadiness.ts', 'utf8')), { exports: policy.exports });
const source = compile(fs.readFileSync('app/(owner)/owner/nrms/reservations/page.tsx', 'utf8'));
function renderDetail(reservation) {
    let stateIndex = 0;
    const module = { exports: {} };
    vm.runInNewContext(source + '\nmodule.exports.Detail=ReservationDetailModal;', {
        module, exports: module.exports, console, Date, URL, URLSearchParams,
        require(name) {
            if (name.includes('NrmsModalFrame'))
                return { default: ({ children }) => children };
            if (name === 'react')
                return { ...React, useState: value => React.useState(stateIndex++ === 0 ? reservation : value) };
            if (name === '@/lib/nrmsRoomReadiness')
                return policy.exports;
            if (name === '@/lib/roomLabels')
                return { tallyRoomLabels: (items, fallback) => items.filter(Boolean).join(', ') || fallback };
            if (name.includes('NrmsProvider'))
                return { useNrms: () => ({ selectedPropertyId: 1 }) };
            if (name.startsWith('@/') || name.startsWith('../') || name === 'next/navigation')
                return new Proxy({}, { get: () => () => null });
            if (name === 'next/link')
                return { default: ({ children, ...props }) => React.createElement('a', props, children) };
            return require(name);
        }
    });
    return renderToStaticMarkup(React.createElement(module.exports.Detail, { reservationId: 1, readOnly: false, onClose() { }, onChanged: async () => { }, onAssignRoom() { } }));
}
const base = { id: 1, status: 'CONFIRMED', source: 'WALK_IN', checkIn: '2026-09-20', checkOut: '2026-09-22', currency: 'TZS', totalAmount: 100, amountPaid: 100, balance: 0, adults: 1, guestProfile: { fullName: 'Test guest' }, allocations: [], payments: [], charges: [] };
const room = id => ({ id: id || 2, status: 'ACTIVE', roomTypeId: 1, roomTypeName: 'Single', roomUnitId: id, roomUnitCode: id ? 'R' + id : null });
test('Review provides assignment and blocks check-in for partial assignment', () => {
    const html = renderDetail({ ...base, allocations: [room(1), room(null)] });
    assert.match(html, /1 of 2 rooms assigned/);
    assert.match(html, />Assign room<\/button>/);
    assert.match(html, /<button[^>]*disabled=""[^>]*>Check in<\/button>/);
});
test('missing allocation offers reservation-specific category recovery', () => {
    const html = renderDetail(base);
    assert.match(html, /Booked room category needs recovery/);
    assert.match(html, />Continue to room assignment<\/button>/);
    assert.doesNotMatch(html, /href="\/owner\/nrms\/rooms"/);
    assert.doesNotMatch(html, />Assign room<\/button>/);
});
test('complete allocation enables check-in', () => {
    const html = renderDetail({ ...base, allocations: [room(1)] });
    assert.doesNotMatch(html, /<button[^>]*disabled=""[^>]*>Check in<\/button>/);
    assert.match(html, />Check in<\/button>/);
});
test('confirmed NoLSAF details expose assignment before code validation', () => {
    const html = renderDetail({ ...base, bookingId: 20, source: 'NOLSAF', marketplaceBooking: { status: 'CONFIRMED', checkInCodeStatus: 'ACTIVE' }, allocations: [room(null)] });
    assert.match(html, />Assign room<\/button>/);
    assert.match(html, /NoLSAF booking confirmed/);
    assert.doesNotMatch(html, />Check in<\/button>/);
});
test('agency-paid guests can reach the same assignment action', () => {
    const html = renderDetail({ ...base, amountPaid: 0, balance: 100, agencySettlement: { settled: true }, allocations: [room(null)] });
    assert.match(html, />Assign room<\/button>/);
    assert.match(html, /Agency payment settled/);
});
