import { Hono } from "hono";

import { authMiddleware } from "../middlewares/auth";

const app = new Hono()
  .use(authMiddleware)
  .get("/events", async (c) =>
    c.json(
      await c.var.api.capture.events({
        cursor: Number(c.req.query("cursor") ?? 0),
        limit: Number(c.req.query("limit") ?? 50),
      }),
    ),
  )
  .get("/events/:id/deliveries", async (c) =>
    c.json(
      await c.var.api.capture.deliveries({
        eventId: Number(c.req.param("id")),
      }),
    ),
  )
  .get("/bookmarks/:id", async (c) =>
    c.json(await c.var.api.capture.status({ bookmarkId: c.req.param("id") })),
  )
  .get("/push", async (c) => c.json(await c.var.api.capture.pushStatus()))
  .post("/devices", async (c) =>
    c.json(await c.var.api.capture.registerDevice(await c.req.json())),
  )
  .delete("/devices/:scope", async (c) =>
    c.json(
      await c.var.api.capture.unregisterDevice({ scope: c.req.param("scope") }),
    ),
  )
  .post("/push/test", async (c) =>
    c.json(await c.var.api.capture.testPush(await c.req.json())),
  );

export default app;
