import { OmitType } from '@nestjs/mapped-types';
import { ActivateInvitationDto } from './activate-invitation.dto';

export class ActivateInvitationByCredentialsDto extends OmitType(
  ActivateInvitationDto,
  ['token'] as const,
) {}
