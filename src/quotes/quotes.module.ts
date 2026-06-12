import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { PdfRendererService } from './pdf/pdf-renderer.service';
import { QuotesController } from './quotes.controller';
import { QuotesService } from './quotes.service';

@Module({
  imports: [AuthModule, SubscriptionsModule],
  controllers: [QuotesController],
  providers: [QuotesService, PdfRendererService],
})
export class QuotesModule {}
