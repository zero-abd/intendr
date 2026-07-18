import { appConfig } from "./config/env";
import { createApp } from "./app";
import { logger } from "./utils/logger";

const app = createApp();

app.listen(appConfig.port, () => {
  logger.info(
    {
      port: appConfig.port,
      lithicEnvironment: appConfig.lithicEnvironment,
      maxVirtualCardAmountCents: appConfig.maxVirtualCardAmountCents,
    },
    "virtual-cards service listening",
  );
});
