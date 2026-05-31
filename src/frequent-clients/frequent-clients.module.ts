import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FrequentClientsController } from './frequent-clients.controller';
import { FrequentClientsService } from './frequent-clients.service';

@Module({
  imports: [AuthModule],
  controllers: [FrequentClientsController],
  providers: [FrequentClientsService],
})
export class FrequentClientsModule {}
