import { afterEach, describe, expect, it, vi } from "vitest";
import { getReleaseMetadata } from "../lib/releaseMetadata.js";

describe("getReleaseMetadata", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses Render's immutable deploy metadata when it is available", () => {
    vi.stubEnv("RENDER_GIT_COMMIT", "ac6c88a856ba617df5693c7a2eee2ddad5c56ef3");
    vi.stubEnv("RENDER_GIT_REPO_SLUG", "danielngeleja/nols-app");

    expect(getReleaseMetadata()).toMatchObject({
      revision: "ac6c88a856ba617df5693c7a2eee2ddad5c56ef3",
      repository: "https://github.com/danielngeleja/nols-app",
    });
  });
});
