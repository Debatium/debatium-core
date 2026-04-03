import "dotenv/config";
import { getConfig } from "./config.js";
import { createApp } from "./app.js";

const config = getConfig();
const { app, logger } = createApp(config);

app.listen(config.port, () => {
  logger.info(`Server running on port ${config.port} [${config.isProd ? "prod" : "dev"}]`);
});
