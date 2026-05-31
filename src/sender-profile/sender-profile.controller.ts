import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireWorkspaceRoles } from '../auth/decorators/require-workspace-roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WorkspaceRoleGuard } from '../auth/guards/workspace-role.guard';
import type { AuthUser } from '../auth/types/auth-user';
import { WORKSPACE_CAPABILITY_ROLES } from '../workspace/workspace-capabilities';
import { SenderProfileService } from './sender-profile.service';
import { UpsertSenderProfileDto } from './dto/upsert-sender-profile.dto';

@Controller('sender-profile')
@UseGuards(JwtAuthGuard, WorkspaceRoleGuard)
export class SenderProfileController {
  constructor(private readonly senderProfileService: SenderProfileService) {}

  @Get()
  getProfile(@CurrentUser() user: AuthUser) {
    return this.senderProfileService.getProfile(user.workspaceId);
  }

  @Put()
  @RequireWorkspaceRoles(...WORKSPACE_CAPABILITY_ROLES.editSenderProfile)
  upsertProfile(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpsertSenderProfileDto,
  ) {
    return this.senderProfileService.upsertProfile(
      user.id,
      user.workspaceId,
      dto,
    );
  }
}
