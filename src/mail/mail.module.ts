import { Module } from '@nestjs/common';
import { InvitationMailService } from './invitation-mail.service';

@Module({
  providers: [InvitationMailService],
  exports: [InvitationMailService],
})
export class MailModule {}
