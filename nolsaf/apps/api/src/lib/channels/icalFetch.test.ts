import { describe, expect, it } from "vitest";
import { assertFetchableFeedUrl, isBlockedAddress, IcalFetchError } from "./icalFetch.js";

describe("isBlockedAddress", () => {
  it("blocks every address that could reach inside the network", () => {
    for (const address of [
      "127.0.0.1", "127.1.2.3", "10.0.0.5", "172.16.4.4", "172.31.255.255", "192.168.1.1",
      "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255",
      "::1", "::", "fd00::1", "fc00::99", "fe80::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:10.1.2.3",
      "::ffff:7f00:1", "::ffff:a00:1", "fec0::1", "64:ff9b::a00:1",
    ]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
  });

  it("allows ordinary public addresses", () => {
    for (const address of ["8.8.8.8", "1.1.1.1", "151.101.1.69", "172.32.0.1", "2606:4700::1111"]) {
      expect(isBlockedAddress(address), address).toBe(false);
    }
  });

  it("blocks anything it cannot parse", () => {
    expect(isBlockedAddress("")).toBe(true);
    expect(isBlockedAddress("not-an-ip")).toBe(true);
    expect(isBlockedAddress("10.0.0")).toBe(true);
  });
});

describe("assertFetchableFeedUrl", () => {
  it("accepts a normal https calendar link", () => {
    const url = assertFetchableFeedUrl("https://www.airbnb.com/calendar/ical/12345.ics?s=abc");
    expect(url.hostname).toBe("www.airbnb.com");
  });

  it("rewrites webcal to https so a pasted subscription link works", () => {
    expect(assertFetchableFeedUrl("webcal://www.airbnb.com/calendar/ical/1.ics").protocol).toBe("https:");
  });

  const rejections: Array<[string, string]> = [
    ["file:///etc/passwd", "UNSUPPORTED_SCHEME"],
    ["http://example.com/calendar.ics", "UNSUPPORTED_SCHEME"],
    ["http://user:pass@example.com/c.ics", "CREDENTIALS_IN_URL"],
    ["https://example.com:8443/c.ics", "BLOCKED_PORT"],
    ["http://localhost/c.ics", "BLOCKED_ADDRESS"],
    ["http://127.0.0.1/c.ics", "BLOCKED_ADDRESS"],
    ["http://169.254.169.254/latest/meta-data/", "BLOCKED_ADDRESS"],
    ["http://[::1]/c.ics", "BLOCKED_ADDRESS"],
    ["not a url", "INVALID_URL"],
  ];

  for (const [input, code] of rejections) {
    it(`rejects ${input} with ${code}`, () => {
      try {
        assertFetchableFeedUrl(input);
        throw new Error("expected a rejection");
      } catch (error) {
        expect(error).toBeInstanceOf(IcalFetchError);
        expect((error as IcalFetchError).code).toBe(code);
      }
    });
  }
});
