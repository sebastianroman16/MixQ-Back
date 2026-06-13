import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { FrequentClientsController } from './frequent-clients.controller';
import { FrequentClientsService } from './frequent-clients.service';

@Module({
  imports: [AuthModule, SubscriptionsModule],
  controllers: [FrequentClientsController],
  providers: [FrequentClientsService],
})
export class FrequentClientsModule {}
