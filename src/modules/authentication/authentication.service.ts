import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../persistence/prisma.service';
import { NuvemshopService } from '../integrations/nuvemshop/nuvemshop.service';
import { OdooService } from '../integrations/odoo/odoo.service';
import * as crypto from 'crypto';

/**
 * AuthenticationService handles customer identity verification
 * using DNI (last N digits) for accessing private order data.
 *
 * Flow:
 * 1. Customer asks about orders
 * 2. AI requests DNI verification via verify_dni tool
 * 3. System looks up customer by email (from PII metadata)
 * 4. Verifies DNI digits match customer records
 * 5. Creates session (30 min expiration)
 * 6. Protected tools check session before accessing data
 */
@Injectable()
export class AuthenticationService {
  private readonly logger = new Logger(AuthenticationService.name);
  private readonly sessionDurationMinutes: number;
  private readonly dniDigitsToVerify: number;
  private readonly authEnabled: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly nuvemshopService: NuvemshopService,
    private readonly odooService: OdooService,
  ) {
    this.authEnabled = this.configService.get<boolean>('AUTH_ENABLED', true);
    this.sessionDurationMinutes = this.configService.get<number>('AUTH_SESSION_DURATION_MINUTES', 30);
    this.dniDigitsToVerify = this.configService.get<number>('AUTH_DNI_DIGITS', 3);

    this.logger.log(
      `AuthenticationService initialized (enabled: ${this.authEnabled}, ` +
      `session: ${this.sessionDurationMinutes}min, dni_digits: ${this.dniDigitsToVerify})`,
    );
  }

  /**
   * Verify DNI and create authenticated session
   *
   * @param conversationId - Chatwoot conversation ID
   * @param email - Customer email (may be PII placeholder, will be resolved)
   * @param dniLastDigits - Last N digits of DNI provided by customer
   * @returns Verification result with session info
   */
  async verifyDNI(
    conversationId: string,
    email: string,
    dniLastDigits: string,
  ): Promise<{
    verified: boolean;
    error?: string;
    sessionExpiresAt?: Date;
  }> {
    this.logger.log(`Verifying DNI for conversation ${conversationId}, email: ${email}`);

    // Check if authentication is enabled
    if (!this.authEnabled) {
      this.logger.warn('Authentication is disabled - creating session without verification');
      return this.createSession(conversationId, email);
    }

    // Validate DNI digits format
    if (!dniLastDigits || dniLastDigits.length !== this.dniDigitsToVerify) {
      return {
        verified: false,
        error: `Please provide the last ${this.dniDigitsToVerify} digits of your DNI`,
      };
    }

    // Validate DNI contains only numbers
    if (!/^\d+$/.test(dniLastDigits)) {
      return {
        verified: false,
        error: 'DNI digits must contain only numbers',
      };
    }

    try {
      // Get integration type from config (odoo or nuvemshop)
      const integrationType = this.configService.get<string>('PRODUCT_INTEGRATION', 'nuvemshop');

      let customerDNI: string | null = null;

      if (integrationType === 'nuvemshop') {
        // Get full orders with customer data (including DNI) by calling client directly
        // We need the raw order data, not simplified, to access contact_identification
        const nuvemshopClient = (this.nuvemshopService as any).client;

        if (!nuvemshopClient) {
          this.logger.error('Nuvemshop client not initialized');
          return {
            verified: false,
            error: 'Service temporarily unavailable. Please try again later.',
          };
        }

        const orders = await nuvemshopClient.searchOrdersByCustomer(email, { limit: 1 });

        if (orders.length === 0) {
          return {
            verified: false,
            error: 'No orders found for this email address',
          };
        }

        // Extract DNI from order (try contact_identification first, then customer.identification)
        // Note: Nuvemshop stores DNI/CPF in the identification field
        const order = orders[0];
        customerDNI = order.contact_identification || order.customer?.identification;

      } else if (integrationType === 'odoo') {
        // For Odoo integration, DNI verification is not yet implemented
        // TODO: Implement Odoo customer lookup by email and DNI verification
        // This requires adding searchCustomerByEmail() method to OdooService
        this.logger.warn('DNI verification not implemented for Odoo integration');
        return {
          verified: false,
          error: 'DNI verification is currently only available for Nuvemshop integration. Please contact support.',
        };
      }

      // Check if DNI was found in records
      if (!customerDNI) {
        this.logger.warn(`No DNI found in records for email: ${email}`);
        return {
          verified: false,
          error: 'No identification number found in your customer profile. Please contact support.',
        };
      }

      // Normalize DNI (remove non-numeric characters for comparison)
      const normalizedDNI = customerDNI.replace(/\D/g, '');

      // Extract last N digits from stored DNI
      const storedLastDigits = normalizedDNI.slice(-this.dniDigitsToVerify);

      // Compare with provided digits
      if (storedLastDigits !== dniLastDigits) {
        this.logger.warn(
          `DNI verification failed for conversation ${conversationId}. ` +
          `Expected last ${this.dniDigitsToVerify} digits to match.`,
        );

        return {
          verified: false,
          error: 'The DNI digits you provided do not match our records. Please try again.',
        };
      }

      // DNI verified - create session
      this.logger.log(`DNI verified successfully for conversation ${conversationId}`);
      return this.createSession(conversationId, email);

    } catch (error) {
      this.logger.error(
        `Error during DNI verification for conversation ${conversationId}`,
        error,
      );

      return {
        verified: false,
        error: 'An error occurred during verification. Please try again later.',
      };
    }
  }

  /**
   * Create authenticated session after successful verification
   *
   * @param conversationId - Chatwoot conversation ID
   * @param email - Customer email
   * @returns Session creation result
   */
  private async createSession(
    conversationId: string,
    email: string,
  ): Promise<{
    verified: boolean;
    sessionExpiresAt: Date;
  }> {
    const expiresAt = new Date(Date.now() + this.sessionDurationMinutes * 60 * 1000);

    // Hash email for privacy (store SHA256 hash instead of plaintext)
    const hashedEmail = this.hashEmail(email);

    try {
      await this.prisma.authSession.upsert({
        where: { conversationId },
        create: {
          conversationId,
          email: hashedEmail,
          verified: true,
          expiresAt,
        },
        update: {
          email: hashedEmail,
          verified: true,
          expiresAt,
          metadata: {}, // Clear any previous metadata (e.g., failed attempts)
        },
      });

      this.logger.log(
        `Session created for conversation ${conversationId}, expires at ${expiresAt.toISOString()}`,
      );

      return {
        verified: true,
        sessionExpiresAt: expiresAt,
      };
    } catch (error) {
      this.logger.error(
        `Failed to create session for conversation ${conversationId}`,
        error,
      );

      throw new Error('Failed to create authentication session');
    }
  }

  /**
   * Get authentication status for a conversation
   *
   * @param conversationId - Chatwoot conversation ID
   * @returns Authentication status with session details
   */
  async getAuthStatus(conversationId: string): Promise<{
    authenticated: boolean;
    email?: string;
    expiresAt?: Date;
    expired?: boolean;
    remainingMinutes?: number;
  }> {
    // If auth is disabled, always return authenticated
    if (!this.authEnabled) {
      return { authenticated: true };
    }

    try {
      const session = await this.prisma.authSession.findUnique({
        where: { conversationId },
      });

      if (!session) {
        return { authenticated: false };
      }

      // Check if session is verified
      if (!session.verified) {
        return { authenticated: false };
      }

      // Check if session has expired
      const now = new Date();
      if (now > session.expiresAt) {
        this.logger.log(`Session expired for conversation ${conversationId}`);
        return {
          authenticated: false,
          expired: true,
        };
      }

      // Calculate remaining time
      const remainingMs = session.expiresAt.getTime() - now.getTime();
      const remainingMinutes = Math.floor(remainingMs / (60 * 1000));

      return {
        authenticated: true,
        email: session.email, // This is hashed - don't expose to AI
        expiresAt: session.expiresAt,
        remainingMinutes,
      };
    } catch (error) {
      this.logger.error(
        `Failed to get auth status for conversation ${conversationId}`,
        error,
      );

      // On error, deny access (fail closed)
      return { authenticated: false };
    }
  }

  /**
   * Expire/delete session for a conversation (logout)
   *
   * @param conversationId - Chatwoot conversation ID
   */
  async expireSession(conversationId: string): Promise<void> {
    try {
      await this.prisma.authSession.delete({
        where: { conversationId },
      });

      this.logger.log(`Session expired for conversation ${conversationId}`);
    } catch (error) {
      // Ignore errors if session doesn't exist
      this.logger.debug(
        `Session deletion attempted for conversation ${conversationId} but session not found`,
      );
    }
  }

  /**
   * Hash email for secure storage
   * Uses SHA-256 to create one-way hash
   *
   * @param email - Email address to hash
   * @returns SHA-256 hash of email (hex string)
   */
  private hashEmail(email: string): string {
    return crypto.createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
  }
}
