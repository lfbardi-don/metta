import { Module, Global } from '@nestjs/common';
import { PersistenceService } from './persistence.service';
import { PrismaService } from './prisma.service';

/**
 * PersistenceModule is global so all modules can inject it
 * to save messages without explicitly importing it
 */
@Global()
@Module({
  providers: [PrismaService, PersistenceService],
  exports: [PrismaService, PersistenceService],
})
export class PersistenceModule {}
