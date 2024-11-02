import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { EventsModule } from './events/events.module';
import { ClientModule } from './clients/client.module';

@Module({
  imports: [EventsModule, ClientModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
