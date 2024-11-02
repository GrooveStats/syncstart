import { Module } from '@nestjs/common';
import { EventsGateway } from './events.gateway';
import { ClientService } from '../clients/client.service';

@Module({
  providers: [EventsGateway, ClientService],
})
export class EventsModule {}
