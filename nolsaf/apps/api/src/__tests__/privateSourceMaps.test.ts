import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendMock = vi.hoisted(() => vi.fn());

vi.mock("@aws-sdk/client-s3", () => ({
  GetObjectCommand: class GetObjectCommand {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  },
  S3Client: class S3Client {
    send = sendMock;
  },
}));

import { buildErrorDiagnostic } from "../lib/errorDiagnostics.js";
import { loadPrivateSourceMap, resetPrivateSourceMapStateForTests } from "../lib/privateSourceMaps.js";

const originalEnvironment = {
  SOURCE_MAP_BUCKET: process.env.SOURCE_MAP_BUCKET,
  SOURCE_MAP_AWS_REGION: process.env.SOURCE_MAP_AWS_REGION,
  SOURCE_MAP_S3_PREFIX: process.env.SOURCE_MAP_S3_PREFIX,
  SOURCE_REPOSITORY_URL: process.env.SOURCE_REPOSITORY_URL,
  SOURCE_REPOSITORY_PATH: process.env.SOURCE_REPOSITORY_PATH,
};

beforeEach(() => {
  process.env.SOURCE_MAP_BUCKET = "private-source-maps";
  process.env.SOURCE_MAP_AWS_REGION = "eu-north-1";
  process.env.SOURCE_MAP_S3_PREFIX = "source-maps";
  process.env.SOURCE_REPOSITORY_URL = "git@github.com:danielngeleja/nols-app.git";
  process.env.SOURCE_REPOSITORY_PATH = "nolsaf";
  resetPrivateSourceMapStateForTests();
  sendMock.mockReset();
});

afterEach(() => {
  for (const [name, value] of Object.entries(originalEnvironment)) {
    if (value == null) delete process.env[name as keyof typeof originalEnvironment];
    else process.env[name as keyof typeof originalEnvironment] = value;
  }
  resetPrivateSourceMapStateForTests();
});

describe("private production source maps", () => {
  it("loads the map for the exact release, maps the frame, and builds an immutable Git link", async () => {
    const payload = JSON.stringify({
      version: 3,
      file: "app.js",
      sources: ["webpack://_N_E/./apps/web/app/admin/revenue/page.tsx"],
      sourcesContent: ["const value = 1;\nthrow new Error('boom');\nconst after = true;"],
      names: ["renderRevenue"],
      mappings: "AACA",
    });
    sendMock.mockResolvedValue({
      ContentLength: Buffer.byteLength(payload),
      Body: { transformToByteArray: async () => new TextEncoder().encode(payload) },
    });

    const diagnostic = await buildErrorDiagnostic({
      service: "web",
      message: "boom",
      stack: "Error: boom\n    at renderRevenue (https://www.nolsaf.com/_next/static/chunks/app.js:1:1)",
      release: "b3708a73cfe759b53319e231e515acc524eaacc4",
    });

    expect(diagnostic.primaryFrame).toMatchObject({
      file: "apps/web/app/admin/revenue/page.tsx",
      line: 2,
      mapped: true,
      sourceLink: "https://github.com/danielngeleja/nols-app/blob/b3708a73cfe759b53319e231e515acc524eaacc4/nolsaf/apps/web/app/admin/revenue/page.tsx#L2",
    });
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0].input).toEqual({
      Bucket: "private-source-maps",
      Key: "source-maps/b3708a73cfe759b53319e231e515acc524eaacc4/_next/static/chunks/app.js.map",
    });

    await buildErrorDiagnostic({
      service: "web",
      message: "boom again",
      stack: "Error: boom\n    at renderRevenue (https://www.nolsaf.com/_next/static/chunks/app.js:1:1)",
      release: "b3708a73cfe759b53319e231e515acc524eaacc4",
    });
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("does not allow arbitrary paths or unsafe release keys to reach S3", async () => {
    await expect(loadPrivateSourceMap("https://www.nolsaf.com/uploads/private.js", "release-1")).resolves.toBeNull();
    await expect(loadPrivateSourceMap("https://www.nolsaf.com/_next/static/chunks/app.js", "../../private")).resolves.toBeNull();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("fails closed when an object is missing or inaccessible", async () => {
    sendMock.mockRejectedValue(Object.assign(new Error("denied"), { name: "AccessDenied" }));
    await expect(loadPrivateSourceMap(
      "https://www.nolsaf.com/_next/static/chunks/app.js",
      "release-1",
    )).resolves.toBeNull();
  });
});
