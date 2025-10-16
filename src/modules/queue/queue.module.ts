import { Module } from '@nestjs/common';
import { QueueService } from './queue.service';
import { QueueProcessor } from './queue.processor';

@Module({
  providers: [QueueService, QueueProcessor],
  exports: [QueueService],
})
export class QueueModule {}
