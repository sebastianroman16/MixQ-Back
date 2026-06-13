import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ActivateInvitationDto } from './dto/activate-invitation.dto';
import { ActivateInvitationByCredentialsDto } from './dto/activate-invitation-by-credentials.dto';
import { VerifyInvitationCredentialsDto } from './dto/verify-invitation-credentials.dto';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { AuthRateLimit } from './decorators/auth-rate-limit.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { AuthRateLimitGuard } from './guards/auth-rate-limit.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import type { AuthUser } from './types/auth-user';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @UseGuards(AuthRateLimitGuard)
  @AuthRateLimit({
    keyPrefix: 'auth:register',
    limit: 5,
    windowMs: 15 * 60 * 1000,
    bodyFields: ['email'],
  })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @UseGuards(AuthRateLimitGuard)
  @AuthRateLimit({
    keyPrefix: 'auth:login',
    limit: 8,
    windowMs: 15 * 60 * 1000,
    bodyFields: ['email'],
  })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('invitations/activate')
  @UseGuards(AuthRateLimitGuard)
  @AuthRateLimit({
    keyPrefix: 'auth:invitation:activate',
    limit: 6,
    windowMs: 15 * 60 * 1000,
    bodyFields: ['email', 'token'],
  })
  activateInvitation(@Body() dto: ActivateInvitationDto) {
    return this.authService.activateInvitation(dto);
  }

  @Post('invitations/verify-credentials')
  @UseGuards(AuthRateLimitGuard)
  @AuthRateLimit({
    keyPrefix: 'auth:invitation:verify-credentials',
    limit: 10,
    windowMs: 15 * 60 * 1000,
    bodyFields: ['email'],
  })
  verifyInvitationCredentials(@Body() dto: VerifyInvitationCredentialsDto) {
    return this.authService.verifyInvitationCredentials(dto);
  }

  @Post('invitations/activate-credentials')
  @UseGuards(AuthRateLimitGuard)
  @AuthRateLimit({
    keyPrefix: 'auth:invitation:activate-credentials',
    limit: 6,
    windowMs: 15 * 60 * 1000,
    bodyFields: ['email'],
  })
  activateInvitationByCredentials(@Body() dto: ActivateInvitationByCredentialsDto) {
    return this.authService.activateInvitationByCredentials(dto);
  }

  @Get('invitations/:token/summary')
  @UseGuards(AuthRateLimitGuard)
  @AuthRateLimit({
    keyPrefix: 'auth:invitation:summary',
    limit: 20,
    windowMs: 15 * 60 * 1000,
  })
  invitationSummary(@Param('token') token: string) {
    return this.authService.getInvitationSummary(token);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthUser) {
    return this.authService.me(user.id);
  }

  @Post('me/dashboard-onboarding-seen')
  @UseGuards(JwtAuthGuard)
  markDashboardOnboardingSeen(@CurrentUser() user: AuthUser) {
    return this.authService.markDashboardOnboardingSeen(user.id);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  logout(@CurrentUser() user: AuthUser) {
    return this.authService.logout(user.id);
  }
}
