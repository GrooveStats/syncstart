import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { LOBBYMAN } from './types/models.types';
import { WsAdapter } from '@nestjs/platform-ws';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useWebSocketAdapter(new WsAdapter(app));

  LOBBYMAN.lobbies = {};
  LOBBYMAN.machineConnections = {};
  LOBBYMAN.spectatorConnections = {};

  await app.listen(1337);

  console.log(`Application is running on: ${await app.getUrl()}`);
}
bootstrap();
