import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../persistence/prisma.service';

/**
 * Horário comercial de atendimento humano
 * Lunes a Viernes 09:00 - 17:00 (Argentina)
 */
const BUSINESS_HOURS = {
  start: 9,
  end: 17,
  timezone: 'America/Argentina/Buenos_Aires',
  workDays: [1, 2, 3, 4, 5], // Monday = 1, Friday = 5
};

/**
 * Thresholds para determinar se é um caso desconhecido
 */
const UNKNOWN_CASE_THRESHOLDS = {
  // Intent OTHERS com qualquer confidence é considerado caso desconhecido
  othersIntent: 'OTHERS',
  // Qualquer intent com confidence abaixo deste valor é considerado desconhecido
  lowConfidenceThreshold: 0.5,
};

export interface UnknownUseCaseData {
  conversationId: string;
  contactId?: string;
  messageContent: string;
  detectedIntent: string;
  confidence: number;
  agentResponse?: string;
}

/**
 * UnknownUseCaseService
 *
 * Gerencia a detecção e auditoria de casos não mapeados.
 * Quando um caso não se encaixa nos use cases existentes:
 * 1. Salva no banco de dados para auditoria
 * 2. Deriva para humano se estiver dentro do horário comercial
 */
@Injectable()
export class UnknownUseCaseService {
  private readonly logger = new Logger(UnknownUseCaseService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Verifica se o caso é desconhecido baseado no intent e confidence
   */
  isUnknownCase(intent: string, confidence: number): boolean {
    // Intent OTHERS sempre é caso desconhecido
    if (intent === UNKNOWN_CASE_THRESHOLDS.othersIntent) {
      return true;
    }

    // Qualquer intent com baixa confidence é caso desconhecido
    if (confidence < UNKNOWN_CASE_THRESHOLDS.lowConfidenceThreshold) {
      return true;
    }

    return false;
  }

  /**
   * Verifica se está dentro do horário comercial (Argentina)
   */
  isWithinBusinessHours(): boolean {
    const now = new Date();

    // Converter para horário de Argentina
    const argentinaTime = new Date(
      now.toLocaleString('en-US', { timeZone: BUSINESS_HOURS.timezone }),
    );

    const dayOfWeek = argentinaTime.getDay();
    const hour = argentinaTime.getHours();

    // Verificar se é dia útil (segunda a sexta)
    // getDay(): 0 = Domingo, 1 = Segunda, ..., 6 = Sábado
    if (!BUSINESS_HOURS.workDays.includes(dayOfWeek)) {
      return false;
    }

    // Verificar se está dentro do horário
    return hour >= BUSINESS_HOURS.start && hour < BUSINESS_HOURS.end;
  }

  /**
   * Salva caso desconhecido para auditoria e retorna se deve derivar para humano
   *
   * @returns true se deve derivar para humano, false caso contrário
   */
  async processUnknownCase(data: UnknownUseCaseData): Promise<{
    saved: boolean;
    shouldHandoff: boolean;
    handoffReason?: string;
  }> {
    const isWithinHours = this.isWithinBusinessHours();

    this.logger.log('Processing unknown use case', {
      conversationId: data.conversationId,
      intent: data.detectedIntent,
      confidence: data.confidence,
      isWithinBusinessHours: isWithinHours,
    });

    try {
      // Salvar no banco para auditoria
      await this.prisma.unknownUseCase.create({
        data: {
          conversationId: data.conversationId,
          contactId: data.contactId,
          messageContent: data.messageContent,
          detectedIntent: data.detectedIntent,
          confidence: data.confidence,
          agentResponse: data.agentResponse,
          wasHandedOff: isWithinHours,
          handoffReason: isWithinHours
            ? 'Caso não mapeado durante horário comercial'
            : undefined,
          metadata: {
            timestamp: new Date().toISOString(),
            businessHoursCheck: {
              isWithinHours,
              currentTimeArgentina: new Date().toLocaleString('es-AR', {
                timeZone: BUSINESS_HOURS.timezone,
              }),
            },
          },
        },
      });

      this.logger.log('Unknown use case saved for audit', {
        conversationId: data.conversationId,
        shouldHandoff: isWithinHours,
      });

      return {
        saved: true,
        shouldHandoff: isWithinHours,
        handoffReason: isWithinHours
          ? 'Caso no mapeado - derivando a humano'
          : undefined,
      };
    } catch (error) {
      this.logger.error('Failed to save unknown use case', {
        error: error.message,
        conversationId: data.conversationId,
      });

      // Mesmo se falhar ao salvar, ainda deriva se estiver em horário comercial
      return {
        saved: false,
        shouldHandoff: isWithinHours,
        handoffReason: isWithinHours
          ? 'Caso no mapeado - derivando a humano'
          : undefined,
      };
    }
  }

  /**
   * Lista casos desconhecidos recentes para análise
   */
  async getRecentUnknownCases(limit = 50): Promise<any[]> {
    return this.prisma.unknownUseCase.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Conta casos desconhecidos por intent para análise
   */
  async getUnknownCaseStats(): Promise<
    { detectedIntent: string; count: number }[]
  > {
    const result = await this.prisma.unknownUseCase.groupBy({
      by: ['detectedIntent'],
      _count: {
        id: true,
      },
      orderBy: {
        _count: {
          id: 'desc',
        },
      },
    });

    return result.map((r) => ({
      detectedIntent: r.detectedIntent,
      count: r._count.id,
    }));
  }
}
