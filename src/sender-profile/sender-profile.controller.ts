import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthUser } from '../auth/types/auth-user';
import { UpsertSenderProfileDto } from './dto/upsert-sender-profile.dto';
import { SenderProfileService } from './sender-profile.service';

@Controller('sender-profile')
@UseGuards(JwtAuthGuard)
export class SenderProfileController {
  constructor(private readonly senderProfileService: SenderProfileService) {}

  @Get()
  getProfile(@CurrentUser() user: AuthUser) {
    return this.senderProfileService.getProfile(user.id);
  }

  @Put()
  upsertProfile(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpsertSenderProfileDto,
  ) {
    return this.senderProfileService.upsertProfile(user.id, dto);
  }
}
