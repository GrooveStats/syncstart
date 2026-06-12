import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { EventsModule } from './events/events.module';
import { ClientModule } from './clients/client.module';
import { MatchLogModule } from './MatchLog/MatchLog.module';

@Module({
  imports: [EventsModule, ClientModule, MatchLogModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
