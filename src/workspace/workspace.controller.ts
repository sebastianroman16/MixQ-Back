import {
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
import { WorkspaceRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireWorkspaceRoles } from '../auth/decorators/require-workspace-roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WorkspaceRoleGuard } from '../auth/guards/workspace-role.guard';
import type { AuthUser } from '../auth/types/auth-user';
import { CreateWorkspaceInvitationDto } from './dto/create-workspace-invitation.dto';
import { UpdateSellerGoalDto } from './dto/update-seller-goal.dto';
import { UpdateWorkspaceMemberRoleDto } from './dto/update-workspace-member-role.dto';
import { WorkspaceService } from './workspace.service';

@Controller('workspace')
@UseGuards(JwtAuthGuard, WorkspaceRoleGuard)
export class WorkspaceController {
  constructor(private readonly workspaceService: WorkspaceService) {}

  @Get('me')
  getMe(@CurrentUser() user: AuthUser) {
    return this.workspaceService.getMe(user);
  }

  @Post('invitations')
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  createInvitation(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateWorkspaceInvitationDto,
  ) {
    return this.workspaceService.createInvitation(user, dto);
  }

  @Get('invitations')
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  listInvitations(@CurrentUser() user: AuthUser) {
    return this.workspaceService.listInvitations(user);
  }

  @Post('invitations/:invitationId/regenerate')
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  regenerateInvitation(
    @CurrentUser() user: AuthUser,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
  ) {
    return this.workspaceService.regenerateInvitation(user, invitationId);
  }

  @Delete('invitations/:invitationId')
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  revokeInvitation(
    @CurrentUser() user: AuthUser,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
  ) {
    return this.workspaceService.revokeInvitation(user, invitationId);
  }

  @Post('invitations/:token/accept')
  acceptInvitation(
    @CurrentUser() user: AuthUser,
    @Param('token') token: string,
  ) {
    return this.workspaceService.acceptInvitation(user, token);
  }

  @Patch('members/:memberId')
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  updateMemberRole(
    @CurrentUser() user: AuthUser,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() dto: UpdateWorkspaceMemberRoleDto,
  ) {
    return this.workspaceService.updateMemberRole(user, memberId, dto);
  }

  @Delete('members/:memberId')
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  removeMember(
    @CurrentUser() user: AuthUser,
    @Param('memberId', ParseUUIDPipe) memberId: string,
  ) {
    return this.workspaceService.removeMember(user, memberId);
  }

  @Patch('members/:memberId/goals')
  @RequireWorkspaceRoles(WorkspaceRole.OWNER)
  updateSellerGoal(
    @CurrentUser() user: AuthUser,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() dto: UpdateSellerGoalDto,
  ) {
    return this.workspaceService.updateSellerGoal(user, memberId, dto);
  }

  @Get('members/metrics')
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  getMembersMetrics(
    @CurrentUser() user: AuthUser,
    @Query('range') range?: 'month' | 'quarter' | 'year',
  ) {
    return this.workspaceService.getMembersMetrics(user, range ?? 'month');
  }

  @Get('metrics/advanced')
  @RequireWorkspaceRoles(WorkspaceRole.OWNER)
  getAdvancedMetrics(
    @CurrentUser() user: AuthUser,
    @Query('range') range?: 'month' | 'quarter' | 'year',
  ) {
    return this.workspaceService.getAdvancedMetrics(user, range ?? 'month');
  }

  @Get('activity')
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  getActivity(@CurrentUser() user: AuthUser) {
    return this.workspaceService.getActivity(user);
  }
}
