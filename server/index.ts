import "dotenv/config";
import { logger } from "./logging/logger";
import { startServer } from "./start";

startServer()
  .then(server => {
    const stop = () => {
      server.stop().finally(() => process.exit(0));
      setTimeout(() => process.exit(1), 10_000).unref();
    };
    process.on("SIGTERM", stop);
    process.on("SIGINT", stop);
  })
  .catch(err => {
    logger.fatal({ err: err instanceof Error ? err.message : String(err) }, "startup failed");
    process.exit(1);
  });
