import { Module } from '@nestjs/common';
import { MatchLogService } from './MatchLog.service';

@Module({
  providers: [MatchLogService],
  exports: [MatchLogService],
})
export class MatchLogModule {}
