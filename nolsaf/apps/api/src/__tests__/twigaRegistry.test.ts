import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ask, ALL_ENTRIES, pendingVerification, HANDOFF_CONFIDENCE_FLOOR } from "../lib/twiga";

/** Convenience: resolve and return just the intent id. */
const intentOf = (utterance: string, language = "en") =>
  ask(utterance, { language: language as any }).entryId;

describe("Twiga registry integrity", () => {
  it("has unique, kebab-case ids", () => {
    const ids = ALL_ENTRIES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it("gives every entry at least one pattern and English copy", () => {
    for (const entry of ALL_ENTRIES) {
      expect(entry.patterns.length, `${entry.id} has no patterns`).toBeGreaterThan(0);
      expect(entry.answer.en.trim().length, `${entry.id} has no English copy`).toBeGreaterThan(0);
    }
  });

  it("keeps em-dashes out of all customer-facing copy", () => {
    for (const entry of ALL_ENTRIES) {
      for (const [lang, copy] of Object.entries(entry.answer)) {
        expect(copy, `${entry.id}.${lang} contains an em-dash`).not.toContain("—");
      }
    }
  });

  it("never spells out what the NoLSAF acronym stands for", () => {
    // The expansion is internal and must not reach a public surface. Twiga is
    // the most public surface there is, so this is checked across every
    // language, not just the English copy.
    const allCopy = ALL_ENTRIES.flatMap((e) => Object.values(e.answer)).join("\n").toLowerCase();
    for (const fragment of [
      "networked occupancy",
      "logistics system-africa",
      "logistics system africa",
    ]) {
      expect(allCopy, `acronym expansion leaked: "${fragment}"`).not.toContain(fragment);
    }
    // The give-away phrasing, in either language.
    expect(allCopy).not.toContain("nolsaf stands for");
    expect(allCopy).not.toContain("nolsaf inasimama kwa");
  });

  it("answers what the name means with what the product does", () => {
    const result = ask("what does NoLSAF stand for");
    expect(result.entryId).toBe("about-nolsaf");
    // Still a real answer, not a refusal.
    expect(result.text.length).toBeGreaterThan(120);
  });

  it("does not reintroduce the stale product claims", () => {
    const allCopy = ALL_ENTRIES.flatMap((e) => Object.values(e.answer)).join("\n").toLowerCase();
    // There is no Stripe integration in the API.
    expect(allCopy).not.toContain("stripe");
    // Plan With Us was retired.
    expect(allCopy).not.toContain("plan with us");
    // Coverage is Tanzania only.
    expect(allCopy).not.toContain("kenya");
    expect(allCopy).not.toContain("maasai mara");
  });
});

describe("resolution by priority, not source order", () => {
  it("routes an explicit request for a human above everything else", () => {
    expect(intentOf("I want to talk to a person")).toBe("human-handoff");
    expect(intentOf("this bot is not helping, get me a human")).toBe("human-handoff");
  });

  it("understands a Kiswahili request for a person, including the widget's own chip", () => {
    expect(intentOf("Nataka kuongea na mtu")).toBe("human-handoff");
    expect(intentOf("naomba kuzungumza na huduma kwa wateja")).toBe("human-handoff");
  });

  it("does not treat the word manager on its own as asking for support", () => {
    expect(intentOf("is there a property manager on site")).not.toBe("human-handoff");
    expect(intentOf("I want to speak to a manager")).toBe("human-handoff");
  });

  it("does not let a generic question word swallow a specific question", () => {
    // The old catch-all matched anything starting with what/who/how, so these
    // never reached their real answers.
    expect(intentOf("what payment methods do you accept?")).toBe("payment-methods");
    expect(intentOf("how do I book a property?")).toBe("how-to-book");
    expect(intentOf("what is NoLSAF?")).toBe("about-nolsaf");
    expect(intentOf("where is my booking?")).toBe("booking-status");
  });

  it("separates the intents that the old keyword ordering conflated", () => {
    // "help" previously always landed on the contact branch, never emergency.
    expect(intentOf("there has been an accident, I need help")).toBe("emergency");
    // "driver" previously hit transport before driver registration.
    expect(intentOf("I want to become a driver")).toBe("become-driver");
    // "how much" previously hit pricing even when asking about commission.
    expect(intentOf("how much do you charge owners?")).toBe("commission");
    // "book" previously beat group stay.
    expect(intentOf("I need a group booking for 30 people")).toBe("group-stay");
  });

  it("answers the services the old bot knew nothing about", () => {
    expect(intentOf("can I book a tour?")).toBe("tours");
    expect(intentOf("I need an invoice for my company")).toBe("invoices-receipts");
    expect(intentOf("how do I list my hotel?")).toBe("become-owner");
  });

  it("corrects the mobile app answer", () => {
    const result = ask("is there a mobile app?");
    expect(result.entryId).toBe("mobile-app");
    expect(result.text.toLowerCase()).toContain("yes");
    expect(result.text.toLowerCase()).not.toContain("roadmap");
  });
});

describe("language handling", () => {
  it("returns Swahili copy when Swahili is requested", () => {
    const sw = ask("habari", { language: "sw" });
    expect(sw.entryId).toBe("greeting");
    expect(sw.text).toContain("Karibu");
    expect(sw.text).toContain("Naweza kukusaidia");
  });

  it("falls back to English rather than returning nothing for an untranslated language", () => {
    const zh = ask("what payment methods do you accept?", { language: "zh" });
    expect(zh.entryId).toBe("payment-methods");
    expect(zh.text.length).toBeGreaterThan(0);
  });
});

describe("handoff signalling", () => {
  it("offers a human when nothing matches", () => {
    const result = ask("qwertyuiop zxcvbnm plughxyzzy frotz blorple");
    expect(result.entryId).toBeNull();
    expect(result.shouldOfferHandoff).toBe(true);
  });

  it("asks for more rather than escalating a one or two word message", () => {
    // "NRMS" typed on its own used to fall through to the fallback and queue a
    // human for a question Twiga can answer.
    for (const utterance of ["qwertyuiop", "zxcvbnm plughxyzzy"]) {
      const result = ask(utterance);
      expect(result.entryId, utterance).toBe("too-short");
      expect(result.shouldOfferHandoff, utterance).toBe(false);
    }
  });

  it("answers NRMS for a visitor instead of falling through", () => {
    const result = ask("NRMS", { audience: "customer" });
    expect(result.entryId).toBe("nrms-for-visitors");
    expect(result.shouldOfferHandoff).toBe(false);
  });

  it("answers a bare product name with what that product is", () => {
    // "NoLSAF" used to return driver registration. The word appears inside
    // become-driver's "drive for nolsaf" pattern, so the fuzzy pass matched it
    // there, and the old fuzzy ordering put priority above match quality so the
    // higher-ranked entry won an incidental match.
    expect(intentOf("NoLSAF")).toBe("about-nolsaf");
    expect(intentOf("nolsaf")).toBe("about-nolsaf");
    expect(intentOf("NRMS")).toBe("nrms-for-visitors");
    expect(intentOf("twiga")).toBe("who-is-twiga");
  });

  it("reads ambiguous words the way a traveller means them", () => {
    // On a travel platform a bare "visa" is an entry visa, not a card brand.
    expect(intentOf("visa")).toBe("visa");
    expect(intentOf("do I need a visa")).toBe("visa");
    // The card reading still works when it is actually about paying.
    expect(intentOf("do you accept visa")).toBe("payment-methods");
    expect(intentOf("can I pay by visa card")).toBe("payment-methods");
    // "where is my money" is a refund question, not a booking lookup.
    expect(intentOf("where is my money")).toBe("cancellation-refund");
  });

  it("still prefers a specific intent when the brand name is only context", () => {
    // The bare-name pattern sits at BRAND priority precisely so it loses to
    // anything more specific. If it ever starts winning these, it is too greedy.
    expect(intentOf("drive for nolsaf")).toBe("become-driver");
    expect(intentOf("how do I book on nolsaf")).toBe("how-to-book");
    expect(intentOf("what payment methods does nolsaf accept")).toBe("payment-methods");
    expect(intentOf("nolsaf commission")).toBe("commission");
    expect(intentOf("is nolsaf safe")).toBe("trust-safety");
  });

  it("does not offer a human on a confident, direct answer", () => {
    const result = ask("how do I book a property?");
    expect(result.confidence).toBeGreaterThanOrEqual(HANDOFF_CONFIDENCE_FLOOR);
    expect(result.shouldOfferHandoff).toBe(false);
  });

  it("still answers through a typo", () => {
    // Fuzzy pass: "cancelation" and "payement" are common misspellings.
    expect(intentOf("I need a cancelation")).toBe("cancellation-refund");
    expect(intentOf("my payement failed")).not.toBeNull();
  });
});

describe("audience scoping", () => {
  it("gives each audience its own greeting", () => {
    expect(ask("hi", { audience: "customer" }).entryId).toBe("greeting");
    expect(ask("hi", { audience: "owner" }).entryId).toBe("owner-greeting");
  });

  it("serves shared entries to both audiences", () => {
    expect(ask("what is nolsaf?", { audience: "owner" }).entryId).toBe("about-nolsaf");
    expect(ask("what is nolsaf?", { audience: "customer" }).entryId).toBe("about-nolsaf");
  });

  it("never leaks owner operations content to a customer", () => {
    const ownerOnly = ["night audit", "housekeeping", "cashier variance", "staff and roles"];
    for (const q of ownerOnly) {
      // A null entryId means the customer fell through to the fallback, which
      // is the intended outcome: they should never see owner operations copy.
      const entryId = ask(q, { audience: "customer" }).entryId ?? "";
      expect(entryId, `"${q}" leaked to customers`).not.toMatch(/^(nrms-|owner-)/);
    }
  });
});

describe("owner and NRMS knowledge", () => {
  const asOwner = (q: string) => ask(q, { audience: "owner" }).entryId;

  it("answers the operational questions the old bot had no concept of", () => {
    expect(asOwner("what is NRMS?")).toBe("nrms-what-is-it");
    expect(asOwner("how do I run the night audit?")).toBe("nrms-night-audit");
    expect(asOwner("how do I add a housekeeper?")).toBe("nrms-staff-access");
    expect(asOwner("I need to set up my restaurant menu")).toBe("nrms-food-beverage");
    expect(asOwner("how do I connect Booking.com?")).toBe("nrms-ota-channels");
    expect(asOwner("what is a group block?")).toBe("nrms-groups-rooming");
    expect(asOwner("a travel agent sent a partnership request")).toBe("nrms-travel-agents");
  });

  it("separates NRMS billing from the general NRMS explainer", () => {
    expect(asOwner("what is nrms")).toBe("nrms-what-is-it");
    expect(asOwner("how much does nrms cost")).toBe("nrms-activation-billing");
    expect(asOwner("my nrms is frozen")).toBe("nrms-activation-billing");
  });

  it("routes the owner's most urgent questions to transactional entries", () => {
    expect(asOwner("when do I get paid?")).toBe("owner-payouts");
    expect(asOwner("why is my property still pending?")).toBe("owner-listing-approval");
    expect(asOwner("a guest has arrived, how do I check them in?")).toBe("owner-bookings-checkin");
  });

  it("is honest that TRA fiscal receipting is not live yet", () => {
    const result = ask("do you issue TRA fiscal receipts?", { audience: "owner" });
    expect(result.entryId).toBe("nrms-fiscal-receipts");
    expect(result.text.toLowerCase()).toContain("not");
    // Must never claim it is working.
    expect(result.text.toLowerCase()).not.toMatch(/receipts are (being )?issued|fully (working|live)/);
  });

  it("does not quote NRMS pricing figures that vary per property", () => {
    const text = ask("how much does nrms cost", { audience: "owner" }).text;
    expect(text).not.toMatch(/\d[\d,]*\s*(tzs|usd)/i);
    expect(text.toLowerCase()).toContain("usage policy");
  });

  it("has Swahili copy for every owner entry, not just English", () => {
    const ownerEntries = ALL_ENTRIES.filter((e) => e.audience === "owner");
    expect(ownerEntries.length).toBeGreaterThan(10);
    for (const entry of ownerEntries) {
      expect(entry.answer.sw, `${entry.id} is missing Swahili`).toBeTruthy();
    }
  });

  it("only deep-links to owner paths that exist in the app router", () => {
    const ownerEntries = ALL_ENTRIES.filter((e) => e.audience === "owner");
    for (const entry of ownerEntries) {
      for (const link of entry.links ?? []) {
        expect(link.href, `${entry.id} link is not an owner path`).toMatch(/^\/owner(\/|$)/);
      }
    }
  });
});

describe("deep links point at real pages", () => {
  /** Route path -> the page file that serves it, or null when apps/web is absent. */
  const appRoutes = (() => {
    const appDir = path.resolve(__dirname, "../../../web/app");
    if (!fs.existsSync(appDir)) return null;

    const routes = new Map<string, string>();
    const walk = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const page = entries.find((e) => e.isFile() && e.name.startsWith("page."));
      if (page) {
        const rel = path.relative(appDir, dir).split(path.sep);
        // Route groups like (owner) are organisational and not part of the URL.
        const segments = rel.filter((s) => s && !(s.startsWith("(") && s.endsWith(")")));
        routes.set("/" + segments.join("/"), path.join(dir, page.name));
      }
      for (const e of entries) {
        if (e.isDirectory()) walk(path.join(dir, e.name));
      }
    };
    walk(appDir);
    return routes;
  })();

  /** Literal, in-app links worth resolving statically. */
  const registryLinks = ALL_ENTRIES.flatMap((entry) =>
    (entry.links ?? [])
      .filter((link) => !/^https?:\/\//.test(link.href))
      .filter((link) => !link.href.includes("["))
      .map((link) => ({ entryId: entry.id, ...link }))
  );

  it("resolves every registry link to a page in the app router", () => {
    if (!appRoutes) return; // apps/web is not checked out alongside apps/api

    const broken = registryLinks
      .filter(({ href }) => !appRoutes.has(href.split("?")[0].replace(/\/$/, "") || "/"))
      .map(({ entryId, label, href }) => `${entryId}: "${label}" -> ${href}`);

    expect(broken, `registry links with no page:\n${broken.join("\n")}`).toEqual([]);
  });

  it("only uses query parameters the target page actually reads", () => {
    if (!appRoutes) return;

    // A path that exists but ignores its query string is a broken promise:
    // "Rates" that lands on a generic controls page, or "Stays in Zanzibar"
    // that shows every property. Resolving the path alone does not catch it.
    const ignored: string[] = [];

    for (const { entryId, label, href } of registryLinks) {
      const [rawPath, query] = href.split("?");
      if (!query) continue;

      const pageFile = appRoutes.get(rawPath.replace(/\/$/, "") || "/");
      if (!pageFile) continue; // already reported by the test above

      const source = fs.readFileSync(pageFile, "utf8");
      for (const param of query.split("&").map((p) => p.split("=")[0])) {
        if (!source.includes(`get("${param}")`) && !source.includes(`get('${param}')`)) {
          ignored.push(`${entryId}: "${label}" -> ${href} (page never reads "${param}")`);
        }
      }
    }

    expect(ignored, `links whose query string does nothing:\n${ignored.join("\n")}`).toEqual([]);
  });

  it("checks a meaningful number of links, so the suite cannot pass by finding none", () => {
    expect(registryLinks.length).toBeGreaterThan(40);
  });
});

describe("product truth backlog", () => {
  it("reports entries awaiting human verification", () => {
    const pending = pendingVerification();
    expect(pending.length).toBeGreaterThan(0);
    for (const item of pending) {
      expect(item.note.trim().length).toBeGreaterThan(0);
    }
  });
});
