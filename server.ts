import "dotenv/config";
import { app, logger, config } from "./app.js";

app.listen(config.port, () => {
  logger.info(`Server running on port ${config.port} [${config.isProd ? "prod" : "dev"}]`);
});
