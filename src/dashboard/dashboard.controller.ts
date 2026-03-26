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

  @Get('overview')
  overview(@CurrentUser() user: AuthUser) {
    return this.dashboardService.getOverview(user.workspaceId);
  }

  @Get('search')
  search(
    @CurrentUser() user: AuthUser,
    @Query('q') query?: string,
  ) {
    return this.dashboardService.search(user.workspaceId, query ?? '');
  }

  @Get('analytics')
  analytics(@CurrentUser() user: AuthUser) {
    return this.dashboardService.getAnalytics(user.workspaceId);
  }

  @Get('summary')
  summary(@CurrentUser() user: AuthUser) {
    return this.dashboardService.getSummary(user.workspaceId);
  }

  @Get('metrics')
  metrics(
    @CurrentUser() user: AuthUser,
    @Query('range') range?: string,
  ) {
    if (range && range !== 'month') {
      throw new BadRequestException('range must be month');
    }

    return this.dashboardService.getMetrics(user.workspaceId, 'month');
  }

  @Get('recent')
  recent(
    @CurrentUser() user: AuthUser,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    return this.dashboardService.getRecent(user.workspaceId, limit ?? 5);
  }

  @Get('alerts')
  alerts(@CurrentUser() user: AuthUser) {
    return this.dashboardService.getAlerts(user.workspaceId);
  }
}
