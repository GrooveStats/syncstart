import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { MatchLogService } from './MatchLog/MatchLog.service';
import { Match } from './MatchLog/MatchLog.types';
import { Lobby, LOBBYMAN } from './types/models.types';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly matchLogService: MatchLogService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('match/list')
  getMatchList(): Match[] {
    return this.matchLogService.getMatches();
  }

  @Get('lobby/list')
  getLobbyList(): Lobby[] {
    return Object.values(LOBBYMAN.lobbies);
  }
}
