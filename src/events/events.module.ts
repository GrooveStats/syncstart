import { Module } from '@nestjs/common';
import { EventsGateway } from './events.gateway';
import { ClientService } from '../clients/client.service';
import { MatchLogModule } from '../MatchLog/MatchLog.module';

@Module({
  imports: [MatchLogModule],
  providers: [EventsGateway, ClientService],
})
export class EventsModule {}
