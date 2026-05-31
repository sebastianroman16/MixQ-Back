import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireWorkspaceRoles } from '../auth/decorators/require-workspace-roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WorkspaceRoleGuard } from '../auth/guards/workspace-role.guard';
import type { AuthUser } from '../auth/types/auth-user';
import { WORKSPACE_CAPABILITY_ROLES } from '../workspace/workspace-capabilities';
import { CreateFrequentClientDto } from './dto/create-frequent-client.dto';
import { UpdateFrequentClientDto } from './dto/update-frequent-client.dto';
import { FrequentClientsService } from './frequent-clients.service';

@Controller('frequent-clients')
@UseGuards(JwtAuthGuard, WorkspaceRoleGuard)
export class FrequentClientsController {
  constructor(private readonly frequentClientsService: FrequentClientsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.frequentClientsService.list(user.workspaceId);
  }

  @Post()
  @RequireWorkspaceRoles(...WORKSPACE_CAPABILITY_ROLES.editQuotes)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateFrequentClientDto) {
    return this.frequentClientsService.create(user.id, user.workspaceId, dto);
  }

  @Patch(':id')
  @RequireWorkspaceRoles(...WORKSPACE_CAPABILITY_ROLES.editQuotes)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFrequentClientDto,
  ) {
    return this.frequentClientsService.update(user.workspaceId, id, dto);
  }

  @Delete(':id')
  @RequireWorkspaceRoles(...WORKSPACE_CAPABILITY_ROLES.editQuotes)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.frequentClientsService.remove(user.workspaceId, id);
  }
}
