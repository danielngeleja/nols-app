import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

const { agentFindFirst } = vi.hoisted(() => ({ agentFindFirst: vi.fn() }));

vi.mock("@nolsaf/prisma", () => ({
  prisma: {
    agent: {
      findFirst: agentFindFirst,
    },
  },
}));

import publicAgentsRouter from "./public.agents.js";

describe("public operator keys", () => {
  it("rejects legacy numeric operator routes without querying by id", async () => {
    const app = express();
    app.use("/api/public/agents", publicAgentsRouter);

    const response = await request(app).get("/api/public/agents/9");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Operator profile not found" });
    expect(agentFindFirst).not.toHaveBeenCalled();
  });
});
