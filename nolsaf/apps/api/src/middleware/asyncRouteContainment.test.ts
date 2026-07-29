import "./asyncRouteContainment";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

describe("Express async route containment", () => {
  it("turns a rejected database promise into a controlled 500 and stays usable", async () => {
    const database = {
      ownerPaygAccount: {
        findMany: vi.fn().mockRejectedValue(
          Object.assign(new Error("column owner_payg_account.maxStaff does not exist"), {
            code: "P2022",
          }),
        ),
      },
    };
    const app = express();

    app.get("/database-failure", async (_req, res) => {
      const rows = await database.ownerPaygAccount.findMany();
      res.json(rows);
    });
    app.get("/still-healthy", async (_req, res) => {
      await Promise.resolve();
      res.status(200).json({ ok: true });
    });
    app.use((
      _error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res.status(500).json({ error: "Internal server error" });
    });

    const failed = await request(app).get("/database-failure");
    expect(failed.status).toBe(500);
    expect(failed.body).toEqual({ error: "Internal server error" });

    const healthy = await request(app).get("/still-healthy");
    expect(healthy.status).toBe(200);
    expect(healthy.body).toEqual({ ok: true });
  });

  it("contains rejected async middleware as well as final route handlers", async () => {
    const app = express();

    app.use("/middleware-failure", async () => {
      throw new Error("middleware rejected");
    });
    app.use((
      _error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res.status(500).json({ contained: true });
    });

    const response = await request(app).get("/middleware-failure");
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ contained: true });
  });
});
