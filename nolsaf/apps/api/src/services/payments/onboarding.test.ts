import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  applicationPayloadHash,
  decideMerchantApplication,
  detachPropertyFromMerchant,
  documentIsExpired,
  getMerchantOverview,
  loadOwnerDocuments,
  matchOwnerWorkspaceTin,
  missingRequiredDocuments,
  missingRequiredFields,
  normalizeTinForMatch,
  OWNER_ENTERED_FIELDS,
  ownerSecurityContact,
  ownerWorkspaceTinStatus,
  sanitizeDraft,
  sanitizeOwnerDraft,
  submitMerchantApplication,
  subscribeMerchant,
  updateMerchantDraft,
} from "./onboarding.js";
import { resetPolicyCache } from "./policy.js";

const dir = mkdtempSync(join(tmpdir(), "nolsaf-onboarding-"));
const policyPath = join(dir, "policy.md");

const ENV = {
  PAYMENTS_ORCHESTRATION_ENABLED: "true",
  PAYMENTS_ORCHESTRATION_ENVIRONMENT: "SANDBOX",
  PAYMENTS_MERCHANT_POLICY_PATH: policyPath,
  PAYMENTS_MERCHANT_POLICY_ID: "merchant-payments",
  PAYMENTS_MERCHANT_POLICY_VERSION: "1.0",
} as NodeJS.ProcessEnv;

const COMPLETE = {
  legalName: "Kilimanjaro View Lodge Ltd",
  tradingName: "Kilimanjaro View Lodge",
  registrationNumber: "123456",
  tin: "111-222-333",
  country: "TZ",
  contactEmail: "owner@example.com",
  contactPhone: "+255754000000",
};

beforeEach(() => {
  resetPolicyCache();
  writeFileSync(policyPath, "Merchant payment terms.\n", "utf8");
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

type DbOptions = {
  application?: any;
  merchant?: any;
  link?: any;
  acceptance?: any;
  connection?: any;
  documents?: any[];
  providerAccount?: any;
  user?: any;
  /** Merchants this owner already administers, for the reuse path. */
  merchants?: any[];
  /** Property links belonging to a merchant. */
  merchantLinks?: any[];
};

function fakeDb(options: DbOptions = {}) {
  const writes: Record<string, any[]> = {
    merchantLegalEntity: [],
    merchantApplication: [],
    merchantProviderAccount: [],
    merchantPropertyLink: [],
    merchantPropertyLinkUpdates: [] as any[],
    merchantPropertyLinkUpdateMany: [] as any[],
    policyAcceptance: [],
    merchantApplicationDocument: [],
    paymentOutboxJob: [],
    merchantAuditEvent: [],
    notification: [],
  };

  const db: any = {
    _writes: writes,
    providerConnection: {
      findFirst: async () =>
        options.connection === undefined
          ? { id: 10, provider: "FAKE", environment: "SANDBOX" }
          : options.connection,
    },
    merchantPropertyLink: {
      findFirst: async () => options.link ?? null,
      findMany: async () => options.merchantLinks ?? [],
      count: async () => (options.merchantLinks ?? []).length,
      create: async ({ data }: any) => {
        writes.merchantPropertyLink.push(data);
        return { id: 1, ...data };
      },
      update: async ({ where, data }: any) => {
        writes.merchantPropertyLinkUpdates.push({ where, data });
        return { id: where?.id, ...data };
      },
      updateMany: async ({ where, data }: any) => {
        writes.merchantPropertyLinkUpdateMany.push({ where, data });
        return { count: 0 };
      },
    },
    merchantLegalEntity: {
      findMany: async () => options.merchants ?? [],
      // administeredById is what the service's independent tenancy check reads.
      findUnique: async () =>
        options.merchant === undefined
          ? { ...COMPLETE, administeredById: 3 }
          : options.merchant,
      create: async ({ data }: any) => {
        writes.merchantLegalEntity.push(data);
        return { id: 7 };
      },
      update: async ({ data }: any) => {
        writes.merchantLegalEntity.push({ _update: data });
        return data;
      },
    },
    merchantApplication: {
      findMany: async () => (options.application ? [options.application] : []),
      findFirst: async () => options.application ?? null,
      findUnique: async () => options.application ?? null,
      create: async ({ data }: any) => {
        writes.merchantApplication.push(data);
        return { id: 99, version: data.version };
      },
      update: async ({ data }: any) => {
        writes.merchantApplication.push({ _update: data });
        return data;
      },
    },
    merchantProviderAccount: {
      create: async ({ data }: any) => {
        writes.merchantProviderAccount.push(data);
        return data;
      },
      update: async ({ data }: any) => {
        writes.merchantProviderAccount.push({ _update: data });
        return data;
      },
      // `=== undefined` rather than `??`, so a test can assert the absent case
      // by passing null explicitly.
      findUnique: async () =>
        options.providerAccount === undefined
          ? { status: "DRAFT", statusReason: null, activatedAt: null }
          : options.providerAccount,
    },
    userDocument: {
      findMany: async () =>
        options.documents ?? [
          { id: 11, type: "BUSINESS_LICENCE", status: "APPROVED", createdAt: new Date() },
          { id: 12, type: "TIN_CERTIFICATE", status: "APPROVED", createdAt: new Date() },
        ],
    },
    user: {
      findUnique: async () => options.user === undefined ? {
        tin: COMPLETE.tin,
        email: COMPLETE.contactEmail,
        phone: COMPLETE.contactPhone,
        emailVerifiedAt: new Date(),
        phoneVerifiedAt: new Date(),
      } : options.user,
    },
    merchantApplicationDocument: {
      deleteMany: async () => ({ count: 0 }),
      create: async ({ data }: any) => {
        writes.merchantApplicationDocument.push(data);
        return data;
      },
    },
    policyAcceptance: {
      findFirst: async () => options.acceptance ?? null,
      updateMany: async () => ({ count: 0 }),
      create: async ({ data }: any) => {
        writes.policyAcceptance.push(data);
        return data;
      },
    },
    paymentOutboxJob: {
      create: async ({ data }: any) => {
        writes.paymentOutboxJob.push(data);
        return data;
      },
    },
    merchantAuditEvent: {
      create: async ({ data }: any) => {
        writes.merchantAuditEvent.push(data);
        return data;
      },
    },
    notification: {
      create: async ({ data }: any) => {
        writes.notification.push(data);
        return { id: 501, ...data };
      },
    },
    $transaction: async (fn: any) => fn(db),
  };
  return db;
}

describe("field allowlist", () => {
  it("drops every key that is not explicitly editable", () => {
    const draft = sanitizeOwnerDraft({
      legalName: "Real Name",
      // All of these are attempts to write columns an owner must never control.
      status: "ACTIVE",
      administeredById: 999,
      id: 1,
      providerMerchantId: "PM-EVIL",
      contactEmail: "employee@example.com",
      contactPhone: "+255700000000",
    } as Record<string, unknown>);

    expect(draft).toEqual({ legalName: "Real Name" });
    expect(Object.keys(draft).every((key) => (OWNER_ENTERED_FIELDS as readonly string[]).includes(key))).toBe(
      true
    );
  });

  it("trims and normalises blanks to null", () => {
    expect(sanitizeDraft({ legalName: "  Spaced  ", tradingName: "   " })).toEqual({
      legalName: "Spaced",
      tradingName: null,
    });
  });

  it("reports the fields still required", () => {
    expect(missingRequiredFields({ legalName: "X" })).toEqual([
      "registrationNumber",
      "tin",
      "country",
      "contactEmail",
      "contactPhone",
    ]);
    expect(missingRequiredFields(COMPLETE)).toEqual([]);
  });
});

describe("Owner Workspace Company TIN matching", () => {
  it("normalizes display punctuation before comparing", () => {
    expect(normalizeTinForMatch(" 111-222-333 ")).toBe("111222333");
    expect(ownerWorkspaceTinStatus("111-222-333", "111 222 333")).toBe("MATCH");
  });

  it("returns only match status and never the stored TIN", async () => {
    const result = await matchOwnerWorkspaceTin(
      fakeDb({ user: { tin: "111-222-333" } }),
      { ownerUserId: 3, tin: "111222333" },
      ENV,
    );
    expect(result).toEqual({ ok: true, status: "MATCH" });
    expect(JSON.stringify(result)).not.toContain("111");
  });

  it("distinguishes a mismatch from a workspace with no TIN", async () => {
    await expect(matchOwnerWorkspaceTin(
      fakeDb({ user: { tin: "111-222-333" } }),
      { ownerUserId: 3, tin: "999-888-777" },
      ENV,
    )).resolves.toEqual({ ok: true, status: "MISMATCH" });
    await expect(matchOwnerWorkspaceTin(
      fakeDb({ user: { tin: null } }),
      { ownerUserId: 3, tin: "999-888-777" },
      ENV,
    )).resolves.toEqual({ ok: true, status: "NOT_ON_FILE" });
  });
});

describe("Owner payment-account security contact", () => {
  it("uses only verified Owner Workspace contacts", () => {
    expect(ownerSecurityContact({
      email: "OWNER@EXAMPLE.COM",
      phone: "+255754000000",
      emailVerifiedAt: new Date(),
      phoneVerifiedAt: null,
    })).toEqual({
      email: "owner@example.com",
      phone: "+255754000000",
      emailVerified: true,
      phoneVerified: false,
    });
  });
});

describe("payload hash", () => {
  it("is independent of key order", () => {
    const a = applicationPayloadHash({ legalName: "A", tin: "1" });
    const b = applicationPayloadHash({ tin: "1", legalName: "A" });
    expect(a).toBe(b);
  });

  it("changes when a value changes", () => {
    expect(applicationPayloadHash({ legalName: "A" })).not.toBe(
      applicationPayloadHash({ legalName: "B" })
    );
  });
});

describe("subscribe creates an inert shell", () => {
  it("submits nothing and enables nothing", async () => {
    const db = fakeDb();
    const result = await subscribeMerchant(db, { ownerUserId: 3, propertyId: 55 }, ENV);

    expect(result).toMatchObject({ ok: true, merchantId: 7 });
    expect(db._writes.merchantLegalEntity[0]).toMatchObject({
      status: "DRAFT",
      contactEmail: COMPLETE.contactEmail,
      contactPhone: COMPLETE.contactPhone,
    });
    expect(db._writes.merchantProviderAccount[0]).toMatchObject({ status: "DRAFT" });
    expect(db._writes.merchantApplication[0]).toMatchObject({ version: 1, status: "DRAFT" });
    // Nothing was queued for the provider.
    expect(db._writes.paymentOutboxJob).toHaveLength(0);
  });

  it("claims the active scope key so a second merchant cannot take the property", async () => {
    const db = fakeDb();
    await subscribeMerchant(db, { ownerUserId: 3, propertyId: 55 }, ENV);
    expect(db._writes.merchantPropertyLink[0]).toMatchObject({ activeScopeKey: "55:ALL" });
  });

  it("releases a stale closed scope before creating the replacement link", async () => {
    const db = fakeDb();
    await subscribeMerchant(db, { ownerUserId: 3, propertyId: 55 }, ENV);

    expect(db._writes.merchantPropertyLinkUpdateMany[0]).toEqual({
      where: { activeScopeKey: "55:ALL", effectiveTo: { not: null } },
      data: { activeScopeKey: null },
    });
    expect(db._writes.merchantPropertyLink[0]).toMatchObject({ activeScopeKey: "55:ALL" });
  });

  it("turns a raced active-scope collision into an already-subscribed refusal", async () => {
    const db = fakeDb();
    db.merchantPropertyLink.create = async () => {
      const error: any = new Error("merchant_property_link_activeScopeKey_key");
      error.code = "P2002";
      error.meta = { target: "merchant_property_link_activeScopeKey_key" };
      throw error;
    };

    await expect(subscribeMerchant(db, { ownerUserId: 3, propertyId: 55 }, ENV)).resolves.toMatchObject({
      ok: false,
      code: "already_subscribed",
    });
  });

  it("refuses a property that is already subscribed", async () => {
    const db = fakeDb({ link: { merchantId: 7 } });
    expect(await subscribeMerchant(db, { ownerUserId: 3, propertyId: 55 }, ENV)).toMatchObject({
      ok: false,
      code: "already_subscribed",
    });
  });

  it("refuses when the feature gate is off", async () => {
    const db = fakeDb();
    expect(await subscribeMerchant(db, { ownerUserId: 3, propertyId: 55 }, {})).toMatchObject({
      ok: false,
      code: "orchestration_disabled",
    });
    expect(db._writes.merchantLegalEntity).toHaveLength(0);
  });
});

describe("detachPropertyFromMerchant", () => {
  it("releases activeScopeKey with the link, so the property can be attached again", async () => {
    // The unique index behind "one active mapping per scope" sits on
    // activeScopeKey, not on effectiveTo. Closing the row without clearing the
    // key left it holding the index, and every later subscribe collided.
    const db = fakeDb({ link: { id: 7, merchantId: 4 }, application: { id: 9, status: "DRAFT", submittedAt: null } });
    const result = await detachPropertyFromMerchant(db, { propertyId: 20 }, ENV);

    expect(result).toMatchObject({ ok: true, merchantId: 4 });
    const update = db._writes.merchantPropertyLinkUpdates[0];
    expect(update.where).toEqual({ id: 7 });
    expect(update.data.activeScopeKey).toBeNull();
    expect(update.data.effectiveTo).toBeInstanceOf(Date);
  });

  it("refuses once the package has been submitted for review", async () => {
    const db = fakeDb({ link: { id: 7, merchantId: 4 }, application: { id: 9, status: "READY_FOR_ADMIN_REVIEW", submittedAt: new Date() } });
    expect(await detachPropertyFromMerchant(db, { propertyId: 20 }, ENV)).toMatchObject({ ok: false, code: "already_submitted" });
    expect(db._writes.merchantPropertyLinkUpdates).toHaveLength(0);
  });

  it("refuses when the property is not attached to anything", async () => {
    const db = fakeDb({ link: null });
    expect(await detachPropertyFromMerchant(db, { propertyId: 20 }, ENV)).toMatchObject({ ok: false, code: "not_subscribed" });
  });
});

describe("one company, several properties", () => {
  it("links a second property to an existing merchant without a second application", async () => {
    const db = fakeDb({ application: { id: 50, version: 1, status: "SUBMISSION_QUEUED" } });
    const result = await subscribeMerchant(
      db,
      { ownerUserId: 3, propertyId: 56, merchantId: 7 },
      ENV
    );

    expect(result).toMatchObject({ ok: true, merchantId: 7, applicationId: 50, reusedMerchant: true });
    // The legal entity, its application and its provider account already exist,
    // so an approved company is never dragged back into a second review.
    expect(db._writes.merchantLegalEntity).toHaveLength(0);
    expect(db._writes.merchantApplication).toHaveLength(0);
    expect(db._writes.merchantProviderAccount).toHaveLength(0);
    expect(db._writes.merchantPropertyLink[0]).toMatchObject({
      merchantId: 7,
      propertyId: 56,
      activeScopeKey: "56:ALL",
    });
    expect(db._writes.merchantAuditEvent[0]).toMatchObject({
      action: "PROPERTY_LINKED",
      reason: "property:56",
    });
  });

  it("opens a draft application when the reused merchant has none for this connection", async () => {
    const db = fakeDb({ application: null, providerAccount: null });
    const result = await subscribeMerchant(
      db,
      { ownerUserId: 3, propertyId: 56, merchantId: 7 },
      ENV
    );

    expect(result).toMatchObject({ ok: true, merchantId: 7, reusedMerchant: true });
    expect(db._writes.merchantApplication[0]).toMatchObject({ version: 1, status: "DRAFT" });
    expect(db._writes.merchantProviderAccount[0]).toMatchObject({ status: "DRAFT" });
  });

  it("refuses a merchant the owner does not administer", async () => {
    const db = fakeDb({ merchant: { administeredById: 999 } });
    expect(
      await subscribeMerchant(db, { ownerUserId: 3, propertyId: 56, merchantId: 7 }, ENV)
    ).toMatchObject({ ok: false, code: "not_administrator" });
    expect(db._writes.merchantPropertyLink).toHaveLength(0);
  });

  it("refuses to add a property to a closed merchant", async () => {
    const db = fakeDb({ merchant: { administeredById: 3, status: "CLOSED" } });
    expect(
      await subscribeMerchant(db, { ownerUserId: 3, propertyId: 56, merchantId: 7 }, ENV)
    ).toMatchObject({ ok: false, code: "merchant_not_reusable" });
    expect(db._writes.merchantPropertyLink).toHaveLength(0);
  });

  it("still refuses a property that already has a merchant", async () => {
    const db = fakeDb({ link: { merchantId: 4 } });
    expect(
      await subscribeMerchant(db, { ownerUserId: 3, propertyId: 55, merchantId: 7 }, ENV)
    ).toMatchObject({ ok: false, code: "already_subscribed" });
  });

  it("returns a conflict instead of throwing when reusable-company linking races", async () => {
    const db = fakeDb({ application: { id: 50, version: 1, status: "DRAFT" } });
    db.merchantPropertyLink.create = async () => {
      const error: any = new Error("merchant_property_link_activeScopeKey_key");
      error.code = "P2002";
      error.meta = { target: "merchant_property_link_activeScopeKey_key" };
      throw error;
    };

    await expect(
      subscribeMerchant(db, { ownerUserId: 3, propertyId: 56, merchantId: 7 }, ENV)
    ).resolves.toMatchObject({ ok: false, code: "already_subscribed" });
  });

  it("offers the owner's existing companies before subscribing", async () => {
    const db = fakeDb({
      link: null,
      application: { id: 50, version: 2, status: "SUBMISSION_QUEUED" },
      providerAccount: { status: "ACTIVE", statusReason: null, activatedAt: new Date() },
      merchants: [{ id: 7, legalName: "Kilimanjaro Holdings Ltd", tradingName: null, status: "DRAFT" }],
      merchantLinks: [{ propertyId: 55, property: { title: "Lodge One" } }],
    });

    const overview = await getMerchantOverview(db, { propertyId: 56, ownerUserId: 3 }, ENV);
    expect(overview).toMatchObject({ ok: true, subscribed: false });
    expect((overview as any).reusableMerchants).toEqual([
      {
        merchantId: 7,
        legalName: "Kilimanjaro Holdings Ltd",
        tradingName: null,
        status: "DRAFT",
        applicationStatus: "SUBMISSION_QUEUED",
        providerStatus: "ACTIVE",
        propertyCount: 1,
      },
    ]);
  });

  it("lists every property a subscribed merchant covers", async () => {
    const db = fakeDb({
      link: { merchantId: 7 },
      merchantLinks: [
        { propertyId: 55, property: { title: "Lodge One" } },
        { propertyId: 56, property: { title: "Lodge Two" } },
      ],
    });

    const overview = await getMerchantOverview(db, { propertyId: 55, ownerUserId: 3 }, ENV);
    expect((overview as any).linkedProperties).toEqual([
      { propertyId: 55, title: "Lodge One" },
      { propertyId: 56, title: "Lodge Two" },
    ]);
  });
});

describe("the service enforces tenancy independently of the route", () => {
  it("refuses every owner mutation for a merchant the caller does not administer", async () => {
    // The route already proves ownership. This check exists so the service
    // still refuses if it is ever called from a new route, worker or script
    // that forgets to.
    const notMine = { ...COMPLETE, administeredById: 4 };

    const draft = fakeDb({ application: { id: 50, version: 1, status: "DRAFT" }, merchant: notMine });
    expect(
      await updateMerchantDraft(draft, { ownerUserId: 3, merchantId: 7, draft: { legalName: "X" } }, ENV)
    ).toMatchObject({ ok: false, code: "not_administrator" });
    expect(draft._writes.merchantLegalEntity).toHaveLength(0);

    const submit = fakeDb({
      application: { id: 50, version: 1, status: "DRAFT" },
      acceptance: { id: 1 },
      merchant: notMine,
    });
    expect(await submitMerchantApplication(submit, { ownerUserId: 3, merchantId: 7 }, ENV)).toMatchObject({
      ok: false,
      code: "not_administrator",
    });
    expect(submit._writes.merchantApplication).toHaveLength(0);
  });
});

describe("corrections preserve reviewed evidence", () => {
  it("edits a DRAFT in place", async () => {
    const db = fakeDb({ application: { id: 50, version: 1, status: "DRAFT" } });
    const result = await updateMerchantDraft(
      db,
      { ownerUserId: 3, merchantId: 7, draft: { legalName: "New" } },
      ENV
    );
    expect(result).toMatchObject({ ok: true, applicationId: 50, version: 1 });
    expect(db._writes.merchantApplication.filter((w) => !w._update)).toHaveLength(0);
  });

  it("cannot redirect provider security contacts through draft input", async () => {
    const db = fakeDb({ application: { id: 50, version: 1, status: "DRAFT" } });
    await updateMerchantDraft(
      db,
      {
        ownerUserId: 3,
        merchantId: 7,
        draft: {
          legalName: "Updated business",
          contactEmail: "employee@example.com",
          contactPhone: "+255700000000",
        },
      },
      ENV,
    );
    expect(db._writes.merchantLegalEntity[0]._update).toMatchObject({
      legalName: "Updated business",
      contactEmail: COMPLETE.contactEmail,
      contactPhone: COMPLETE.contactPhone,
    });
  });

  it("opens a new version when editing an application that was returned", async () => {
    // The reviewer's copy must stay intact.
    const db = fakeDb({ application: { id: 50, version: 1, status: "ACTION_REQUIRED" } });
    const result = await updateMerchantDraft(
      db,
      { ownerUserId: 3, merchantId: 7, draft: { legalName: "Corrected" } },
      ENV
    );
    expect(result).toMatchObject({ ok: true, version: 2 });
    expect(db._writes.merchantApplication[0]).toMatchObject({ version: 2, status: "DRAFT" });
  });

  it("refuses edits while under review", async () => {
    for (const status of ["READY_FOR_ADMIN_REVIEW", "SUBMISSION_QUEUED", "PROVIDER_REVIEW", "ACTIVE"]) {
      const db = fakeDb({ application: { id: 50, version: 1, status } });
      expect(
        await updateMerchantDraft(db, { ownerUserId: 3, merchantId: 7, draft: { legalName: "X" } }, ENV),
        `${status} must not be editable`
      ).toMatchObject({ ok: false, code: "not_editable" });
    }
  });

  // The approved package is what the provider was given. Nothing an owner can
  // send may alter the legal identity after that point, or after a rejection,
  // so this asserts the refusal AND that no write reached the merchant row.
  it("freezes the legal identity permanently once decided", async () => {
    const decided = [
      "SUBMISSION_QUEUED",
      "PROVIDER_REVIEW",
      "SUBMITTED",
      "PENDING_PROVIDER",
      "ACTIVE",
      "SUSPENDED",
      "ADMIN_REJECTED",
      "PROVIDER_REJECTED",
    ];

    for (const status of decided) {
      const db = fakeDb({ application: { id: 50, version: 1, status } });
      const result = await updateMerchantDraft(
        db,
        {
          ownerUserId: 3,
          merchantId: 7,
          draft: { legalName: "Renamed", tin: "999", registrationNumber: "999", country: "KE" },
        },
        ENV
      );

      expect(result, `${status} must refuse edits`).toMatchObject({ ok: false, code: "not_editable" });
      expect(db._writes.merchantLegalEntity, `${status} must write nothing`).toHaveLength(0);
      expect(db._writes.merchantApplication, `${status} must open no new version`).toHaveLength(0);
    }
  });
});

describe("submission", () => {
  const acceptance = { id: 1 };

  it("refuses without a current policy acceptance", async () => {
    const db = fakeDb({ application: { id: 50, version: 1, status: "DRAFT" }, acceptance: null });
    expect(await submitMerchantApplication(db, { ownerUserId: 3, merchantId: 7 }, ENV)).toMatchObject({
      ok: false,
      code: "policy_not_accepted",
    });
  });

  it("refuses an incomplete application", async () => {
    const db = fakeDb({
      application: { id: 50, version: 1, status: "DRAFT" },
      acceptance,
      merchant: { legalName: "Only a name", administeredById: 3 },
    });
    expect(await submitMerchantApplication(db, { ownerUserId: 3, merchantId: 7 }, ENV)).toMatchObject({
      ok: false,
      code: "incomplete_application",
    });
  });

  it("refuses when the Company TIN does not match Owner Workspace", async () => {
    const db = fakeDb({
      application: { id: 50, version: 1, status: "DRAFT" },
      acceptance,
      user: {
        tin: "999-888-777",
        email: COMPLETE.contactEmail,
        phone: COMPLETE.contactPhone,
        emailVerifiedAt: new Date(),
        phoneVerifiedAt: new Date(),
      },
    });
    expect(await submitMerchantApplication(db, { ownerUserId: 3, merchantId: 7 }, ENV)).toMatchObject({
      ok: false,
      code: "owner_tin_mismatch",
    });
    expect(db._writes.merchantApplication).toHaveLength(0);
  });

  it("refuses when Owner Workspace has no Company TIN", async () => {
    const db = fakeDb({
      application: { id: 50, version: 1, status: "DRAFT" },
      acceptance,
      user: {
        tin: null,
        email: COMPLETE.contactEmail,
        phone: COMPLETE.contactPhone,
        emailVerifiedAt: new Date(),
        phoneVerifiedAt: new Date(),
      },
    });
    expect(await submitMerchantApplication(db, { ownerUserId: 3, merchantId: 7 }, ENV)).toMatchObject({
      ok: false,
      code: "owner_tin_not_configured",
    });
    expect(db._writes.merchantApplication).toHaveLength(0);
  });

  it("refuses when the Owner security contacts are not both verified", async () => {
    const db = fakeDb({
      application: { id: 50, version: 1, status: "DRAFT" },
      acceptance,
      user: {
        tin: COMPLETE.tin,
        email: COMPLETE.contactEmail,
        phone: COMPLETE.contactPhone,
        emailVerifiedAt: new Date(),
        phoneVerifiedAt: null,
      },
    });
    expect(await submitMerchantApplication(db, { ownerUserId: 3, merchantId: 7 }, ENV)).toMatchObject({
      ok: false,
      code: "owner_contact_not_verified",
    });
    expect(db._writes.merchantApplication).toHaveLength(0);
  });

  it("freezes the package with a server-computed hash", async () => {
    const db = fakeDb({ application: { id: 50, version: 1, status: "DRAFT" }, acceptance });
    const result = await submitMerchantApplication(db, { ownerUserId: 3, merchantId: 7 }, ENV);

    expect(result).toMatchObject({ ok: true, applicationId: 50 });
    const update = db._writes.merchantApplication.find((w) => w._update)!._update;
    expect(update).toMatchObject({ status: "READY_FOR_ADMIN_REVIEW" });
    expect(update.payloadHash).toBe(applicationPayloadHash(COMPLETE));
    expect(update.frozenAt).toBeInstanceOf(Date);
  });
});

describe("KYC documents are linked, never re-collected", () => {
  const acceptance = { id: 1 };
  const draftApp = { id: 50, version: 1, status: "DRAFT" };

  it("folds both spellings of licence onto one canonical type", async () => {
    const documents = [
      { id: 11, type: "BUSINESS_LICENSE", status: "APPROVED", createdAt: new Date() },
      { id: 12, type: "TIN_CERTIFICATE", status: "APPROVED", createdAt: new Date() },
    ];
    expect(missingRequiredDocuments(await loadOwnerDocuments(fakeDb({ documents }), 3))).toEqual([]);
  });

  it("keeps only the newest upload per type", async () => {
    const documents = [
      { id: 20, type: "TIN_CERTIFICATE", status: "APPROVED", createdAt: new Date() },
      { id: 12, type: "TIN_CERTIFICATE", status: "REJECTED", createdAt: new Date() },
    ];
    const loaded = await loadOwnerDocuments(fakeDb({ documents }), 3);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toMatchObject({ userDocumentId: 20, status: "APPROVED" });
  });

  it("counts a rejected upload as missing", () => {
    expect(
      missingRequiredDocuments([
        { userDocumentId: 11, documentType: "BUSINESS_LICENCE", status: "REJECTED", uploadedAt: null, expiresAt: null },
        { userDocumentId: 12, documentType: "TIN_CERTIFICATE", status: "APPROVED", uploadedAt: null, expiresAt: null },
      ])
    ).toEqual(["BUSINESS_LICENCE"]);
  });

  it("treats an approved expired business licence as missing", async () => {
    const at = new Date("2026-09-04T00:00:00.000Z");
    const documents = await loadOwnerDocuments(fakeDb({
      documents: [
        { id: 11, type: "BUSINESS_LICENCE", status: "APPROVED", createdAt: at, metadata: { expiresAt: "2026-09-03T23:59:59.000Z" } },
        { id: 12, type: "TIN_CERTIFICATE", status: "APPROVED", createdAt: at },
      ],
    }), 3);

    expect(documentIsExpired(documents[0]!, at)).toBe(true);
    expect(missingRequiredDocuments(documents, at)).toEqual(["BUSINESS_LICENCE"]);
  });

  it("keeps a current business licence eligible", async () => {
    const at = new Date("2026-09-04T00:00:00.000Z");
    const documents = await loadOwnerDocuments(fakeDb({
      documents: [
        { id: 11, type: "BUSINESS_LICENCE", status: "APPROVED", createdAt: at, metadata: { expiresOn: "2027-09-04" } },
        { id: 12, type: "TIN_CERTIFICATE", status: "APPROVED", createdAt: at },
      ],
    }), 3);

    expect(documentIsExpired(documents[0]!, at)).toBe(false);
    expect(missingRequiredDocuments(documents, at)).toEqual([]);
  });

  it("refuses submission when a required document is absent", async () => {
    const db = fakeDb({ application: draftApp, acceptance, documents: [] });
    const result = await submitMerchantApplication(db, { ownerUserId: 3, merchantId: 7 }, ENV);
    expect(result).toMatchObject({ ok: false, code: "incomplete_application" });
    if (!result.ok) expect(result.message).toContain("BUSINESS_LICENCE");
  });

  it("snapshots the linked uploads onto the application", async () => {
    // Replacing a document later must not silently change what was approved.
    const db = fakeDb({ application: draftApp, acceptance });
    await submitMerchantApplication(db, { ownerUserId: 3, merchantId: 7 }, ENV);

    expect(db._writes.merchantApplicationDocument).toHaveLength(2);
    expect(db._writes.merchantApplicationDocument[0]).toMatchObject({
      applicationId: 50,
      userDocumentId: 11,
      documentType: "BUSINESS_LICENCE",
      verificationState: "VERIFIED",
    });
  });

  it("never copies a document location onto the application", async () => {
    const db = fakeDb({ application: draftApp, acceptance });
    await submitMerchantApplication(db, { ownerUserId: 3, merchantId: 7 }, ENV);
    for (const row of db._writes.merchantApplicationDocument) {
      expect(row.storageKey).toBeUndefined();
    }
  });

  it("carries a not-yet-approved upload across as PENDING", async () => {
    const db = fakeDb({
      application: draftApp,
      acceptance,
      documents: [
        { id: 11, type: "BUSINESS_LICENCE", status: "PENDING", createdAt: new Date() },
        { id: 12, type: "TIN_CERTIFICATE", status: "APPROVED", createdAt: new Date() },
      ],
    });
    await submitMerchantApplication(db, { ownerUserId: 3, merchantId: 7 }, ENV);
    expect(db._writes.merchantApplicationDocument[0]).toMatchObject({
      documentType: "BUSINESS_LICENCE",
      verificationState: "PENDING",
    });
  });
});

describe("owner overview", () => {
  it("returns a safe provider status reason without provider identifiers", async () => {
    const db = fakeDb({
      link: { merchantId: 7 },
      application: { id: 50, version: 1, status: "READY_FOR_ADMIN_REVIEW", submittedAt: new Date(), decisionReason: null },
      providerAccount: { status: "SUSPENDED", statusReason: "Business licence expired", activatedAt: null },
    });

    const result = await getMerchantOverview(db, { propertyId: 4, ownerUserId: 3 }, ENV);
    expect(result).toMatchObject({
      ok: true,
      providerAccount: { status: "SUSPENDED", statusReason: "Business licence expired" },
      ownerSecurityContact: {
        email: COMPLETE.contactEmail,
        phone: COMPLETE.contactPhone,
        emailVerified: true,
        phoneVerified: true,
      },
    });
    expect(JSON.stringify(result)).not.toContain("providerMerchantId");
    expect(JSON.stringify(result)).not.toContain("providerWalletId");
  });
});

describe("administrator decisions", () => {
  const pending = {
    id: 50,
    merchantId: 7,
    connectionId: 10,
    version: 1,
    status: "READY_FOR_ADMIN_REVIEW",
    merchant: { administeredById: 3 },
  };

  it("approval never activates, it only queues submission", async () => {
    // The single most important assertion in this file.
    const db = fakeDb({ application: pending });
    const result = await decideMerchantApplication(
      db,
      { applicationId: 50, adminUserId: 99, decision: "APPROVE", reason: "Documents verified" },
      ENV
    );

    expect(result).toMatchObject({ ok: true, status: "SUBMISSION_QUEUED" });
    const accountUpdate = db._writes.merchantProviderAccount.find((w) => w._update)!._update;
    expect(accountUpdate.status).toBe("SUBMISSION_QUEUED");
    expect(accountUpdate.status).not.toBe("ACTIVE");

    const applied = JSON.stringify(db._writes);
    expect(applied).not.toContain('"ACTIVE"');
  });

  it("records the flagged correction areas on the return's own audit row", async () => {
    // A return used to carry only free text, so the owner had to guess which
    // part of the application was wrong.
    const db = fakeDb({ application: pending });
    const result = await decideMerchantApplication(
      db,
      { applicationId: 50, adminUserId: 99, decision: "RETURN", reason: "TIN is unreadable", correctionAreas: ["TAX_IDENTIFIERS", "DOCUMENTS"] },
      ENV
    );

    expect(result).toMatchObject({ ok: true, status: "ACTION_REQUIRED" });
    const entry = db._writes.merchantAuditEvent.find((event: any) => event.action === "APPLICATION_RETURN");
    expect(entry.metadata).toEqual({ correctionAreas: ["TAX_IDENTIFIERS", "DOCUMENTS"] });
  });

  it("drops correction areas it does not recognise", async () => {
    const db = fakeDb({ application: pending });
    await decideMerchantApplication(
      db,
      { applicationId: 50, adminUserId: 99, decision: "RETURN", reason: "fix it", correctionAreas: ["DOCUMENTS", "BANK_ACCOUNT" as never] },
      ENV
    );
    const entry = db._writes.merchantAuditEvent.find((event: any) => event.action === "APPLICATION_RETURN");
    expect(entry.metadata).toEqual({ correctionAreas: ["DOCUMENTS"] });
  });

  it("ignores correction areas on decisions the owner cannot act on", async () => {
    // Approving or rejecting gives the owner nothing to go back and correct,
    // so an area list there would be a promise the workflow cannot keep.
    const db = fakeDb({ application: pending });
    await decideMerchantApplication(
      db,
      { applicationId: 50, adminUserId: 99, decision: "APPROVE", reason: "verified", correctionAreas: ["DOCUMENTS"] },
      ENV
    );
    const entry = db._writes.merchantAuditEvent.find((event: any) => event.action === "APPLICATION_APPROVE");
    expect(entry.metadata).toBeUndefined();
  });

  it("queues an idempotent outbox job on approval", async () => {
    const db = fakeDb({ application: pending });
    await decideMerchantApplication(
      db,
      { applicationId: 50, adminUserId: 99, decision: "APPROVE", reason: "ok" },
      ENV
    );
    expect(db._writes.paymentOutboxJob[0]).toMatchObject({
      jobType: "SUBMIT_MERCHANT_APPLICATION",
      idempotencyKey: "submit-application:50:v1",
    });
  });

  it("refuses when the deciding admin administers the merchant", async () => {
    // Separation of duties.
    const db = fakeDb({ application: pending });
    expect(
      await decideMerchantApplication(
        db,
        { applicationId: 50, adminUserId: 3, decision: "APPROVE", reason: "ok" },
        ENV
      )
    ).toMatchObject({ ok: false, code: "self_review_forbidden" });
    expect(db._writes.paymentOutboxJob).toHaveLength(0);
  });

  it("refuses to approve when the stored details no longer match the frozen package", async () => {
    const db = fakeDb({
      application: {
        ...pending,
        payloadHash: applicationPayloadHash({ ...COMPLETE, legalName: "What the reviewer saw" }),
        // The merchant row now says something else.
        merchant: { administeredById: 3, ...COMPLETE },
      },
    });

    expect(
      await decideMerchantApplication(
        db,
        { applicationId: 50, adminUserId: 9, decision: "APPROVE", reason: "Looks fine" },
        ENV
      )
    ).toMatchObject({ ok: false, code: "package_altered" });
    expect(db._writes.paymentOutboxJob).toHaveLength(0);
    expect(db._writes.merchantApplication).toHaveLength(0);
  });

  it("still allows a return when the package was altered, so the owner can fix it", async () => {
    const db = fakeDb({
      application: {
        ...pending,
        payloadHash: applicationPayloadHash({ ...COMPLETE, legalName: "What the reviewer saw" }),
        merchant: { administeredById: 3, ...COMPLETE },
      },
    });

    expect(
      await decideMerchantApplication(
        db,
        { applicationId: 50, adminUserId: 9, decision: "RETURN", reason: "Details changed" },
        ENV
      )
    ).toMatchObject({ ok: true, status: "ACTION_REQUIRED" });
  });

  it("approves when the frozen package still matches the stored details", async () => {
    const db = fakeDb({
      application: {
        ...pending,
        payloadHash: applicationPayloadHash(COMPLETE),
        merchant: { administeredById: 3, ...COMPLETE },
      },
    });

    expect(
      await decideMerchantApplication(
        db,
        { applicationId: 50, adminUserId: 9, decision: "APPROVE", reason: "Verified" },
        ENV
      )
    ).toMatchObject({ ok: true, status: "SUBMISSION_QUEUED" });
  });

  it("refuses to decide on an application that is not awaiting review", async () => {
    for (const status of ["DRAFT", "SUBMISSION_QUEUED", "ACTIVE", "ADMIN_REJECTED"]) {
      const db = fakeDb({ application: { ...pending, status } });
      expect(
        await decideMerchantApplication(
          db,
          { applicationId: 50, adminUserId: 99, decision: "APPROVE", reason: "ok" },
          ENV
        ),
        `${status} must not be decidable`
      ).toMatchObject({ ok: false, code: "not_decidable" });
    }
  });

  it("returns for correction without queuing anything", async () => {
    const db = fakeDb({ application: pending });
    const result = await decideMerchantApplication(
      db,
      { applicationId: 50, adminUserId: 99, decision: "RETURN", reason: "TIN unreadable" },
      ENV
    );
    expect(result).toMatchObject({ ok: true, status: "ACTION_REQUIRED" });
    expect(db._writes.paymentOutboxJob).toHaveLength(0);
  });

  it("records the reason on every decision", async () => {
    const db = fakeDb({ application: pending });
    await decideMerchantApplication(
      db,
      { applicationId: 50, adminUserId: 99, decision: "REJECT", reason: "Entity not registered" },
      ENV
    );
    expect(db._writes.merchantAuditEvent[0]).toMatchObject({
      action: "APPLICATION_REJECT",
      actorUserId: 99,
      reason: "Entity not registered",
    });
    expect(db._writes.notification[0]).toMatchObject({
      ownerId: 3,
      userId: 3,
      title: "Payment application was not approved",
      meta: { kind: "merchant_application_reject", actionUrl: "/owner/nrms/payments" },
    });
  });

  it("tells the owner that local approval is not provider activation", async () => {
    const db = fakeDb({ application: pending });
    await decideMerchantApplication(
      db,
      { applicationId: 50, adminUserId: 99, decision: "APPROVE", reason: "Documents verified" },
      ENV
    );
    expect(db._writes.notification[0]).toMatchObject({
      ownerId: 3,
      title: "Payment application approved by NoLSAF",
    });
    expect(db._writes.notification[0].body).toContain("not active yet");
  });
});
