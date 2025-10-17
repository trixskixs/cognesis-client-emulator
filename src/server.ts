import http from "http";
import config from "./config";
import FixtureRegistry from "./fixtures";
import { sessionStore } from "./sessionStore";
import { createApp } from "./app";

async function bootstrap(): Promise<void> {
  const fixtureRegistry = await FixtureRegistry.init();
  const app = createApp({ fixtureRegistry });
  const server = http.createServer(app);

  const cleanupInterval = setInterval(() => {
    sessionStore.cleanupExpired();
  }, 60_000);

  server.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`Orchestrator emulator listening on http://localhost:${config.port}`);
  });

  const shutdown = () => {
    clearInterval(cleanupInterval);
    server.close(() => {
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start emulator", error);
  process.exit(1);
});
