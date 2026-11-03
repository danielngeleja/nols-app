import { test } from "node:test";
import assert from "node:assert/strict";
import { getDriverGateState } from "./driverGate.ts";

const completeDriver = {
  role: "DRIVER", kycStatus: "APPROVED_KYC", name: "Driver", email: "driver@example.test",
  phone: "+255700000001", gender: "F", nationality: "Tanzanian", nin: "123",
  region: "Dar es Salaam", district: "Ilala", operationArea: "Dar es Salaam",
  vehicleType: "CAR", plateNumber: "T123ABC", licenseNumber: "LIC123",
  paymentPhone: "+255700000001", paymentVerified: true,
  documents: ["DRIVER_LICENSE", "NATIONAL_ID", "VEHICLE_REGISTRATION", "INSURANCE"]
    .map((type) => ({ type, url: `https://example.test/${type}`,
      metadata: type === "DRIVER_LICENSE" ? { expiresAt: "2099-12-31" } : null })),
};

test("approved driver with the required documents passes the mobile gate", () => {
  assert.equal(getDriverGateState(completeDriver), "ok");
});

test("a missing required document keeps onboarding incomplete", () => {
  assert.equal(getDriverGateState({ ...completeDriver, documents: completeDriver.documents.slice(1) }), "incomplete_onboarding");
});

test("a license without a valid expiry cannot enter protected driver screens", () => {
  const expired = completeDriver.documents.map((document) => document.type === "DRIVER_LICENSE"
    ? { ...document, metadata: { expiresAt: "2020-01-01" } }
    : document);
  assert.equal(getDriverGateState({ ...completeDriver, documents: expired }), "incomplete_onboarding");
});

test("suspended and rejected drivers remain gated", () => {
  assert.equal(getDriverGateState({ ...completeDriver, suspendedAt: "2026-11-03T00:00:00Z" }), "suspended");
  assert.equal(getDriverGateState({ ...completeDriver, kycStatus: "REJECTED_KYC" }), "rejected");
});
