import type { Express } from "express";
import type pg from "pg";
import { registerAdminRoutes } from "./admin/routes";
import { registerAttachmentRoutes } from "./attachments/routes";
import { registerCatalogueRoutes } from "./catalogue/routes";
import { registerClinicalRoutes } from "./clinical/routes";
import { registerDispensingRoutes } from "./dispensing/routes";
import { registerImportRoutes } from "./importer/routes";
import { registerPurchaseOrderRoutes } from "./purchasing/orders";
import { registerPurchasingRoutes } from "./purchasing/routes";
import { registerReportRoutes } from "./reports/routes";
import { registerCountRoutes } from "./stock/counts";
import { registerStockOperationRoutes } from "./stock/operations";
import { registerStockRoutes } from "./stock/routes";
import { registerTransferRoutes } from "./stock/transfers";
import { registerVialRoutes } from "./stock/vials";
import { registerVoiceRoutes, type VoiceDeps } from "./voice/routes";

export type ModuleDeps = { voice: VoiceDeps };

/**
 * Every business module registers its routes here. To add a module: create modules/<name>/routes.ts
 * exporting registerXRoutes(app, pool), and add one line below. Each module owns its own SQL,
 * validation and permission checks, and shares only http/ and the stock ledger.
 */
export function registerModules(app: Express, pool: pg.Pool, deps: ModuleDeps) {
  registerCatalogueRoutes(app, pool);
  registerPurchasingRoutes(app, pool);
  registerPurchaseOrderRoutes(app, pool);
  registerAttachmentRoutes(app, pool);
  registerStockRoutes(app, pool);
  registerStockOperationRoutes(app, pool);
  registerTransferRoutes(app, pool);
  registerCountRoutes(app, pool);
  registerVialRoutes(app, pool);
  registerClinicalRoutes(app, pool);
  registerDispensingRoutes(app, pool);
  registerReportRoutes(app, pool);
  registerImportRoutes(app, pool);
  registerAdminRoutes(app, pool);
  registerVoiceRoutes(app, pool, deps.voice);
}
