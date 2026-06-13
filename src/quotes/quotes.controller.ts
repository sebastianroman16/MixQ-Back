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
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { WorkspaceRole } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireWorkspaceRoles } from '../auth/decorators/require-workspace-roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WorkspaceRoleGuard } from '../auth/guards/workspace-role.guard';
import type { AuthUser } from '../auth/types/auth-user';
import { WORKSPACE_CAPABILITY_ROLES } from '../workspace/workspace-capabilities';
import { CreateQuoteDto } from './dto/create-quote.dto';
import { CreateQuoteFolderDto } from './dto/create-quote-folder.dto';
import { ChangeQuoteStatusDto } from './dto/change-quote-status.dto';
import { AssignQuoteFolderDto } from './dto/assign-quote-folder.dto';
import { AssignQuoteSellerDto } from './dto/assign-quote-seller.dto';
import { UpdateQuoteDto } from './dto/update-quote.dto';
import { QuotesService } from './quotes.service';

@Controller('quotes')
@UseGuards(JwtAuthGuard, WorkspaceRoleGuard)
export class QuotesController {
  constructor(private readonly quotesService: QuotesService) {}

  @Post()
  @RequireWorkspaceRoles(...WORKSPACE_CAPABILITY_ROLES.editQuotes)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateQuoteDto) {
    return this.quotesService.create(user.id, user.workspaceId, dto);
  }

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('client') client?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('minTotal') minTotal?: string,
    @Query('maxTotal') maxTotal?: string,
    @Query('folderId') folderId?: string,
    @Query('favoriteIds') favoriteIds?: string,
    @Query('onlyFavorites') onlyFavorites?: string,
    @Query('sellerId') sellerId?: string,
  ) {
    if (
      page ||
      pageSize ||
      search ||
      status ||
      client ||
      dateFrom ||
      dateTo ||
      minTotal ||
      maxTotal ||
      folderId ||
      favoriteIds ||
      onlyFavorites ||
      sellerId
    ) {
      return this.quotesService.listPage(user.id, user.role, user.workspaceId, {
        page,
        pageSize,
        search,
        status,
        client,
        dateFrom,
        dateTo,
        minTotal,
        maxTotal,
        folderId,
        favoriteIds,
        onlyFavorites,
        sellerId,
      });
    }
    return this.quotesService.list(user.id, user.role, user.workspaceId);
  }

  @Get('composer-bootstrap')
  composerBootstrap(@CurrentUser() user: AuthUser) {
    return this.quotesService.getComposerBootstrap(user.id, user.role, user.workspaceId);
  }

  @Get('favorites')
  listFavorites(@CurrentUser() user: AuthUser) {
    return this.quotesService.listFavorites(user.id, user.workspaceId);
  }

  @Get('folders')
  listFolders(@CurrentUser() user: AuthUser) {
    return this.quotesService.listFolders(user.workspaceId);
  }

  @Post('folders')
  @RequireWorkspaceRoles(...WORKSPACE_CAPABILITY_ROLES.editQuotes)
  createFolder(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateQuoteFolderDto,
  ) {
    return this.quotesService.createFolder(user.id, user.workspaceId, dto);
  }

  @Delete('folders/:folderId')
  @RequireWorkspaceRoles(...WORKSPACE_CAPABILITY_ROLES.editQuotes)
  removeFolder(
    @CurrentUser() user: AuthUser,
    @Param('folderId', ParseUUIDPipe) folderId: string,
  ) {
    return this.quotesService.removeFolder(user.workspaceId, folderId);
  }

  @Get(':id/pdf')
  async exportPdf(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const pdfBuffer = await this.quotesService.exportPdf(
      user.id,
      user.role,
      user.workspaceId,
      id,
    );
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="quote-${id}.pdf"`,
    });
    return new StreamableFile(pdfBuffer);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.quotesService.get(user.id, user.role, user.workspaceId, id);
  }

  @Patch(':id')
  @RequireWorkspaceRoles(...WORKSPACE_CAPABILITY_ROLES.editQuotes)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateQuoteDto,
  ) {
    return this.quotesService.update(user.id, user.role, user.workspaceId, id, dto);
  }

  @Post(':id/status')
  @RequireWorkspaceRoles(...WORKSPACE_CAPABILITY_ROLES.editQuotes)
  changeStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeQuoteStatusDto,
  ) {
    return this.quotesService.changeStatus(
      user.id,
      user.role,
      user.workspaceId,
      id,
      dto.status,
    );
  }

  @Post(':id/favorite')
  setFavorite(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.quotesService.setFavorite(user.id, user.role, user.workspaceId, id, true);
  }

  @Delete(':id/favorite')
  removeFavorite(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.quotesService.setFavorite(user.id, user.role, user.workspaceId, id, false);
  }

  @Patch(':id/folder')
  @RequireWorkspaceRoles(...WORKSPACE_CAPABILITY_ROLES.editQuotes)
  assignFolder(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignQuoteFolderDto,
  ) {
    return this.quotesService.assignFolder(
      user.id,
      user.role,
      user.workspaceId,
      id,
      dto.folderId ?? null,
    );
  }

  @Patch(':id/seller')
  @RequireWorkspaceRoles(WorkspaceRole.OWNER)
  assignSeller(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignQuoteSellerDto,
  ) {
    return this.quotesService.assignSeller(user.workspaceId, id, dto.sellerId);
  }

  @Post(':id/duplicate')
  @RequireWorkspaceRoles(...WORKSPACE_CAPABILITY_ROLES.editQuotes)
  duplicate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.quotesService.duplicate(user.id, user.role, user.workspaceId, id);
  }

  @Delete(':id')
  @RequireWorkspaceRoles(...WORKSPACE_CAPABILITY_ROLES.editQuotes)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.quotesService.remove(user.id, user.role, user.workspaceId, id);
  }
}
