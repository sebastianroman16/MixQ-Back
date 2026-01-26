import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SenderProfileController } from './sender-profile.controller';
import { SenderProfileService } from './sender-profile.service';

@Module({
  imports: [AuthModule],
  controllers: [SenderProfileController],
  providers: [SenderProfileService],
})
export class SenderProfileModule {}
