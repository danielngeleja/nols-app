import { describe, expect, it, vi } from "vitest";

import { databaseSslCaFromEnvironment } from "./databaseSslCa.js";

describe("databaseSslCaFromEnvironment", () => {
  it("prefers the inline certificate and expands escaped newlines", () => {
    const readFile = vi.fn();

    expect(
      databaseSslCaFromEnvironment(
        { DB_SSL_CA: "BEGIN\\nCERTIFICATE", DB_SSL_CA_FILE: "/ignored.pem" },
        readFile,
      ),
    ).toBe("BEGIN\nCERTIFICATE");
    expect(readFile).not.toHaveBeenCalled();
  });

  it("loads the certificate from the configured file", () => {
    const readFile = vi.fn(() => "  trusted certificate  \n");

    expect(
      databaseSslCaFromEnvironment({ DB_SSL_CA_FILE: "/runtime/rds-ca.pem" }, readFile),
    ).toBe("trusted certificate");
    expect(readFile).toHaveBeenCalledWith("/runtime/rds-ca.pem", "utf8");
  });

  it("fails when a configured certificate file cannot be read", () => {
    expect(() =>
      databaseSslCaFromEnvironment(
        { DB_SSL_CA_FILE: "/missing.pem" },
        () => {
          throw new Error("not found");
        },
      ),
    ).toThrow("Unable to read DB_SSL_CA_FILE at /missing.pem: not found");
  });
});
