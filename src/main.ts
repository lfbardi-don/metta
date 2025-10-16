import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';

const logger = new Logger('Bootstrap');

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn', 'debug', 'verbose'],
  });

  // Enable graceful shutdown
  app.enableShutdownHooks();

  // Graceful shutdown handlers
  const gracefulShutdown = async (signal: string) => {
    logger.log(`Received ${signal}, closing application gracefully...`);

    try {
      await app.close();
      logger.log('Application closed successfully');
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown', error);
      process.exit(1);
    }
  };

  // Handle shutdown signals
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  // Start HTTP server (for health checks and test endpoints)
  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  logger.log(`Metta Worker is running on port ${port}`);
  logger.log('QueueProcessor will start automatically');
  logger.log('Press CTRL+C to stop gracefully');
}

bootstrap().catch((error) => {
  logger.error('Failed to start application', error);
  process.exit(1);
});
