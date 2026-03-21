import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ActivateInvitationDto } from './dto/activate-invitation.dto';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { CurrentUser } from './decorators/current-user.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import type { AuthUser } from './types/auth-user';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('invitations/activate')
  activateInvitation(@Body() dto: ActivateInvitationDto) {
    return this.authService.activateInvitation(dto);
  }

  @Get('invitations/:token/summary')
  invitationSummary(@Param('token') token: string) {
    return this.authService.getInvitationSummary(token);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthUser) {
    return this.authService.me(user.id);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  logout(@CurrentUser() user: AuthUser) {
    return this.authService.logout(user.id);
  }
}
