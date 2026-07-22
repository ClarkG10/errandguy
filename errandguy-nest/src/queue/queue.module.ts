import { Global, Module } from '@nestjs/common';
import { QueueService } from './queue.service';
import { QueueWorkerService } from './queue-worker.service';

/** DB-backed queue: enqueue via QueueService, drained by QueueWorkerService. */
@Global()
@Module({
  providers: [QueueService, QueueWorkerService],
  exports: [QueueService],
})
export class QueueModule {}
