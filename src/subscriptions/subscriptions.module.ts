import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FlowClientService } from './flow/flow-client.service';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';

@Module({
  imports: [AuthModule],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService, FlowClientService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
