import { dbManager } from './database';
import { server } from './server';

async function main() {
  console.log("Initializing SQLite database...");
  await dbManager.init();

  const PORT = parseInt(process.env.PORT || '3000', 10);
  const appServer = server.start(PORT);

  // Handle graceful shutdown
  const shutdown = () => {
    console.log("\nShutting down server...");
    appServer.close(() => {
      console.log("HTTP server closed.");
      dbManager.close();
      console.log("Database connection closed. Safe exit.");
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
