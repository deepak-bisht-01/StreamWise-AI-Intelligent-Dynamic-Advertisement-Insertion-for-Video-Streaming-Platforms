const { env, assertEnv } = require('./config/env');
const { connectDatabase } = require('./config/supabase');
const app = require('./app');
const logger = require('./utils/logger');

const SHUTDOWN_TIMEOUT = 10000; // 10 seconds

async function start() {
  assertEnv();
  await connectDatabase();

  const server = app.listen(env.port, () => {
    logger.info({ message: `Lumina API listening on port ${env.port}`, port: env.port, environment: env.nodeEnv });
  });

  const gracefulShutdown = (signal) => {
    logger.info({ message: `${signal} received, starting graceful shutdown` });
    
    // Stop accepting new connections
    server.close(() => {
      logger.info({ message: 'Server closed successfully' });
      process.exit(0);
    });

    // Force shutdown after timeout
    setTimeout(() => {
      logger.error({ message: 'Forced shutdown after timeout' });
      process.exit(1);
    }, SHUTDOWN_TIMEOUT);
  };

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  
  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    logger.error({ message: 'Uncaught exception', error: error.message, stack: error.stack });
    gracefulShutdown('uncaughtException');
  });
  
  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason, promise) => {
    logger.error({ message: 'Unhandled promise rejection', reason, promise });
    gracefulShutdown('unhandledRejection');
  });
}

start().catch((error) => {
  logger.error({ message: 'Failed to start server', error: error.message, stack: error.stack });
  process.exit(1);
});
