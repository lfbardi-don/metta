import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthenticationService } from './authentication.service';
import { IntegrationsModule } from '../integrations/integrations.module';

/**
 * AuthenticationModule handles customer identity verification
 * using DNI (last N digits) for accessing private order data.
 *
 * Imports:
 * - ConfigModule: For AUTH_* environment variables
 * - IntegrationsModule: For Nuvemshop/Odoo services to verify DNI
 *
 * Note: PersistenceModule is @Global, so PrismaService is auto-injected
 */
@Module({
  imports: [ConfigModule, IntegrationsModule],
  providers: [AuthenticationService],
  exports: [AuthenticationService],
})
export class AuthenticationModule {}
