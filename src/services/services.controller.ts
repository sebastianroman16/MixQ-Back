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
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireWorkspaceRoles } from '../auth/decorators/require-workspace-roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WorkspaceRoleGuard } from '../auth/guards/workspace-role.guard';
import type { AuthUser } from '../auth/types/auth-user';
import { WORKSPACE_CAPABILITY_ROLES } from '../workspace/workspace-capabilities';
import { CreateCategoryDto } from './dto/create-category.dto';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { ServicesService } from './services.service';

@Controller('services')
@UseGuards(JwtAuthGuard, WorkspaceRoleGuard)
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  @Post()
  @RequireWorkspaceRoles(...WORKSPACE_CAPABILITY_ROLES.editServices)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateServiceDto) {
    return this.servicesService.create(user.id, user.workspaceId, dto);
  }

  @Get()
  findAll(
    @CurrentUser() user: AuthUser,
    @Query('categoryId') categoryId?: string,
    @Query('search') search?: string,
  ) {
    return this.servicesService.findAll(user.workspaceId, { categoryId, search });
  }

  @Post('categories')
  @RequireWorkspaceRoles(...WORKSPACE_CAPABILITY_ROLES.editServices)
  createCategory(@CurrentUser() user: AuthUser, @Body() dto: CreateCategoryDto) {
    return this.servicesService.createCategory(user.id, user.workspaceId, dto);
  }

  @Get('categories')
  listCategories(@CurrentUser() user: AuthUser) {
    return this.servicesService.listCategories(user.workspaceId);
  }

  @Get('categories/:id')
  getCategory(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.servicesService.getCategory(user.workspaceId, id);
  }

  @Patch('categories/:id')
  @RequireWorkspaceRoles(...WORKSPACE_CAPABILITY_ROLES.editServices)
  updateCategory(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.servicesService.updateCategory(user.workspaceId, id, dto);
  }

  @Delete('categories/:id')
  @RequireWorkspaceRoles(...WORKSPACE_CAPABILITY_ROLES.editServices)
  removeCategory(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.servicesService.removeCategory(user.workspaceId, id);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.servicesService.findOne(user.workspaceId, id);
  }

  @Patch(':id')
  @RequireWorkspaceRoles(...WORKSPACE_CAPABILITY_ROLES.editServices)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateServiceDto,
  ) {
    return this.servicesService.update(user.id, user.workspaceId, id, dto);
  }

  @Delete(':id')
  @RequireWorkspaceRoles(...WORKSPACE_CAPABILITY_ROLES.editServices)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.servicesService.remove(user.workspaceId, id);
  }
}
