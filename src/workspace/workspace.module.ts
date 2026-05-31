import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InvitationMailService } from '../mail/invitation-mail.service';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { WorkspaceController } from './workspace.controller';
import { WorkspaceService } from './workspace.service';

@Module({
  imports: [AuthModule, SubscriptionsModule],
  controllers: [WorkspaceController],
  providers: [WorkspaceService, InvitationMailService],
  exports: [WorkspaceService],
})
export class WorkspaceModule {}
