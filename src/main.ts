import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { LOBBYMAN } from './types/models.types';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  LOBBYMAN.lobbies = {};
  LOBBYMAN.activePlayers = {};

  await app.listen(3000);
}
bootstrap();
