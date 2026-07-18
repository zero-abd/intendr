import type { NextFunction, Request, Response } from "express";

import { appConfig } from "../config/env";
import { UnauthorizedError } from "../virtual-cards/virtualCard.errors";

/**
 * Service-to-service authentication for internal-only routes
 * (credential consumption). Requires `Authorization: Bearer <INTERNAL_SERVICE_TOKEN>`.
 *
 * This middleware MUST guard every path that can return PAN/CVV or redeem a
 * vault token. It is never applied to the public card-creation endpoint's
 * response shape (that endpoint never returns credentials).
 */
export function internalServiceAuth(req: Request, _res: Response, next: NextFunction): void {
  const configured = appConfig.internalServiceToken;
  if (!configured) {
    next(new UnauthorizedError("Internal service authentication is not configured."));
    return;
  }

  const header = req.header("authorization") ?? req.header("Authorization");
  if (!header || !header.startsWith("Bearer ")) {
    next(new UnauthorizedError("Missing or invalid Authorization header."));
    return;
  }

  const token = header.slice("Bearer ".length).trim();
  if (!token || token !== configured) {
    next(new UnauthorizedError("Invalid service token."));
    return;
  }

  next();
}
