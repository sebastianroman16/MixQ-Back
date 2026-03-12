import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { ServicesModule } from './services/services.module';
import { TemplatesModule } from './templates/templates.module';
import { QuotesModule } from './quotes/quotes.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { SenderProfileModule } from './sender-profile/sender-profile.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { WorkspaceModule } from './workspace/workspace.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule,
    AuthModule,
    ServicesModule,
    TemplatesModule,
    QuotesModule,
    DashboardModule,
    SenderProfileModule,
    SubscriptionsModule,
    WorkspaceModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
