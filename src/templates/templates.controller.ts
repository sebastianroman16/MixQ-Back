import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { TemplateType } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireWorkspaceRoles } from '../auth/decorators/require-workspace-roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WorkspaceRoleGuard } from '../auth/guards/workspace-role.guard';
import type { AuthUser } from '../auth/types/auth-user';
import { WORKSPACE_CAPABILITY_ROLES } from '../workspace/workspace-capabilities';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { TemplatesService } from './templates.service';

@Controller('templates')
@UseGuards(JwtAuthGuard, WorkspaceRoleGuard)
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('type') type?: string) {
    return this.templatesService.list(user.workspaceId, this.parseType(type));
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.templatesService.get(user.workspaceId, id);
  }

  @Post()
  @RequireWorkspaceRoles(...WORKSPACE_CAPABILITY_ROLES.editTemplates)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTemplateDto) {
    return this.templatesService.create(user.id, user.workspaceId, dto);
  }

  @Post(':id/clone')
  @RequireWorkspaceRoles(...WORKSPACE_CAPABILITY_ROLES.editTemplates)
  clone(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.templatesService.cloneFromSystem(user.id, user.workspaceId, id);
  }

  @Patch(':id')
  @RequireWorkspaceRoles(...WORKSPACE_CAPABILITY_ROLES.editTemplates)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTemplateDto,
  ) {
    return this.templatesService.update(user.workspaceId, id, dto);
  }

  @Delete(':id')
  @RequireWorkspaceRoles(...WORKSPACE_CAPABILITY_ROLES.editTemplates)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.templatesService.remove(user.workspaceId, id);
  }

  private parseType(value?: string) {
    if (!value) {
      return undefined;
    }

    const normalized = value.trim().toLowerCase();
    if (normalized === 'system') {
      return TemplateType.SYSTEM;
    }

    if (normalized === 'user') {
      return TemplateType.USER;
    }

    throw new BadRequestException('Invalid template type');
  }
}
