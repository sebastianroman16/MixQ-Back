import {
  BadRequestException,
  Controller,
  Get,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthUser } from '../auth/types/auth-user';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('summary')
  summary(@CurrentUser() user: AuthUser) {
    return this.dashboardService.getSummary(user.id);
  }

  @Get('metrics')
  metrics(
    @CurrentUser() user: AuthUser,
    @Query('range') range = 'month',
  ) {
    if (range !== 'month') {
      throw new BadRequestException('Unsupported range');
    }
    return this.dashboardService.getMetrics(user.id, range);
  }

  @Get('recent')
  recent(
    @CurrentUser() user: AuthUser,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 5,
  ) {
    return this.dashboardService.getRecent(user.id, limit);
  }

  @Get('alerts')
  alerts(@CurrentUser() user: AuthUser) {
    return this.dashboardService.getAlerts(user.id);
  }
}
