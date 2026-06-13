import { OmitType } from '@nestjs/mapped-types';
import { ActivateInvitationDto } from './activate-invitation.dto';

export class VerifyInvitationCredentialsDto extends OmitType(
  ActivateInvitationDto,
  ['token', 'newPassword'] as const,
) {}
