import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { ServicesService } from './services.service';
import { ServicesController } from './services.controller';

@Module({
  imports: [AuthModule, SubscriptionsModule],
  controllers: [ServicesController],
  providers: [ServicesService],
})
export class ServicesModule {}
