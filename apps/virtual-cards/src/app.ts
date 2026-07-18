import express from "express";

import { errorHandler } from "./virtual-cards/virtualCard.controller";
import {
  internalCredentialRouter,
  virtualCardRouter,
} from "./virtual-cards/virtualCard.routes";

/**
 * Express application factory. Separated from `index.ts` so tests can mount
 * the app without binding a port.
 */
export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));

  app.get("/healthz", (_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.use("/api/virtual-cards", virtualCardRouter);
  app.use("/internal", internalCredentialRouter);

  app.use(errorHandler);
  return app;
}
