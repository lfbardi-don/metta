import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import {
  UseCase,
  UseCaseType,
  UseCaseStatus,
  UseCaseStep,
} from '../../../common/interfaces/use-case.interface';
import {
  ConversationState,
  CustomerGoal,
  GoalType,
} from '../../../common/interfaces/conversation-state.interface';
import {
  USE_CASE_WORKFLOWS,
  STEP_DESCRIPTIONS,
} from '../config/use-case-workflows.config';

/**
 * Use Case Detection Service (REFACTORED for Goals)
 *
 * Detects and manages customer goals (simplified from use cases).
 * This service:
 * - Detects goal type from message and classifier intent
 * - Creates new goals or continues existing ones
 * - Simplified: NO step tracking (removed brittle keyword matching)
 * - Focuses on WHAT the customer wants, not HOW we process it
 */
@Injectable()
export class UseCaseDetectionService {
  private readonly logger = new Logger(UseCaseDetectionService.name);

  /**
   * Detect customer goal from message and classifier intent (SIMPLIFIED)
   *
   * @param message - User message
   * @param classifierIntent - Intent from Metta Classifier
   * @param conversationHistory - Recent messages
   * @param currentState - Current conversation state
   * @returns Detected goal or null
   */
  detectGoal(
    message: string,
    classifierIntent: string,
    conversationHistory: any[],
    currentState: ConversationState | null,
  ): CustomerGoal | null {
    // Map classifier intent to goal type
    const goalType = this.mapIntentToGoalType(message, classifierIntent);

    if (!goalType) return null;

    // Check if there's an active goal of the same type OR related type (continue it)
    const existingGoal = currentState?.state?.activeGoal;
    if (existingGoal) {
      const isSameType = existingGoal.type === goalType;

      // Treat PRODUCT_SEARCH and PRODUCT_QUESTION as related (same journey)
      const isProductRelated =
        (existingGoal.type === GoalType.PRODUCT_SEARCH ||
          existingGoal.type === GoalType.PRODUCT_QUESTION) &&
        (goalType === GoalType.PRODUCT_SEARCH ||
          goalType === GoalType.PRODUCT_QUESTION);

      if (isSameType || isProductRelated) {
        this.logger.log(`Continuing existing goal: ${existingGoal.type} (detected as ${goalType})`);
        return {
          ...existingGoal,
          lastActivityAt: new Date(),
        };
      }
    }

    // Create new goal
    const newGoal: CustomerGoal = {
      goalId: uuidv4(),
      type: goalType,
      status: 'active',
      startedAt: new Date(),
      lastActivityAt: new Date(),
      context: this.extractContext(message, goalType),
      progressMarkers: [],
      detectedFrom: message.substring(0, 100), // First 100 chars
    };

    this.logger.log(`New goal detected: ${goalType}`, {
      goalId: newGoal.goalId,
    });

    return newGoal;
  }

  /**
   * Map classifier intent to simplified goal type
   */
  private mapIntentToGoalType(
    message: string,
    classifierIntent: string,
  ): GoalType | null {
    const messageLower = message.toLowerCase();

    // ORDER_STATUS intent → ORDER_INQUIRY goal
    if (classifierIntent === 'ORDER_STATUS') {
      return GoalType.ORDER_INQUIRY;
    }

    // PRODUCT_INFO intent → PRODUCT_SEARCH or PRODUCT_QUESTION
    if (classifierIntent === 'PRODUCT_INFO') {
      // If asking about specific product details (size, availability)
      if (
        messageLower.includes('talle') ||
        messageLower.includes('size') ||
        messageLower.includes('stock') ||
        messageLower.includes('disponible')
      ) {
        return GoalType.PRODUCT_QUESTION;
      }
      // Otherwise it's a search
      return GoalType.PRODUCT_SEARCH;
    }

    // STORE_INFO intent → STORE_INFO goal
    if (classifierIntent === 'STORE_INFO') {
      return GoalType.STORE_INFO;
    }

    // OTHERS intent → GREETING goal
    if (classifierIntent === 'OTHERS') {
      return GoalType.GREETING;
    }

    return GoalType.OTHER;
  }

  /**
   * Extract minimal context from message
   */
  private extractContext(
    message: string,
    goalType: GoalType,
  ): CustomerGoal['context'] {
    const context: CustomerGoal['context'] = {};

    // Extract order number for order inquiries
    if (goalType === GoalType.ORDER_INQUIRY) {
      const orderMatch = message.match(/#?(\d+)/);
      if (orderMatch) {
        context.orderId = orderMatch[1];
      }
      context.topic = 'order_inquiry';
    }

    // Extract product context for product goals
    if (
      goalType === GoalType.PRODUCT_SEARCH ||
      goalType === GoalType.PRODUCT_QUESTION
    ) {
      context.topic = goalType === GoalType.PRODUCT_SEARCH ? 'product_search' : 'product_details';
      // Product IDs will be added dynamically as conversation progresses
      context.productIds = [];
    }

    // Store info topics
    if (goalType === GoalType.STORE_INFO) {
      const messageLower = message.toLowerCase();
      if (messageLower.includes('horario') || messageLower.includes('hours')) {
        context.topic = 'store_hours';
      } else if (
        messageLower.includes('devolucion') ||
        messageLower.includes('return')
      ) {
        context.topic = 'return_policy';
      } else if (
        messageLower.includes('contacto') ||
        messageLower.includes('telefono')
      ) {
        context.topic = 'contact';
      } else {
        context.topic = 'general_info';
      }
    }

    return context;
  }

  /**
   * Detect use case from message and classifier intent
   *
   * @param message - User message
   * @param classifierIntent - Intent from Metta Classifier
   * @param conversationHistory - Recent messages
   * @param currentState - Current conversation state
   * @returns Detected use case or null
   */
  detectUseCase(
    message: string,
    classifierIntent: string,
    conversationHistory: any[],
    currentState: ConversationState | null,
  ): UseCase | null {
    // Map classifier intent to use case type
    const useCaseType = this.mapIntentToUseCaseType(message, classifierIntent);

    if (!useCaseType) return null;

    // Check if this use case is already active
    const existingCase = currentState?.state?.useCases?.activeCases?.find(
      (uc) =>
        uc.type === useCaseType && uc.status === UseCaseStatus.IN_PROGRESS,
    );

    if (existingCase) {
      this.logger.log(`Continuing existing use case: ${useCaseType}`);
      return existingCase;
    }

    // Create new use case
    const newCase: UseCase = {
      useCaseId: uuidv4(),
      type: useCaseType,
      status: UseCaseStatus.PENDING,
      startedAt: new Date(),
      steps: this.initializeSteps(useCaseType),
      context: this.extractUseCaseContext(message, useCaseType),
      metadata: {
        detectedFromMessage: message,
        classifierIntent,
      },
    };

    this.logger.log(`New use case detected: ${useCaseType}`, {
      useCaseId: newCase.useCaseId,
    });

    return newCase;
  }

  /**
   * Map classifier intent to use case type
   */
  private mapIntentToUseCaseType(
    message: string,
    classifierIntent: string,
  ): UseCaseType | null {
    const messageLower = message.toLowerCase();

    // ORDER_STATUS intent
    if (classifierIntent === 'ORDER_STATUS') {
      if (
        messageLower.includes('seguimiento') ||
        messageLower.includes('tracking')
      ) {
        return UseCaseType.TRACK_SHIPMENT;
      }
      if (messageLower.includes('pago') || messageLower.includes('payment')) {
        return UseCaseType.VERIFY_PAYMENT;
      }
      if (
        messageLower.includes('devolucion') ||
        messageLower.includes('return') ||
        messageLower.includes('devolver')
      ) {
        return UseCaseType.REQUEST_RETURN;
      }
      return UseCaseType.CHECK_ORDER_STATUS;
    }

    // PRODUCT_INFO intent
    if (classifierIntent === 'PRODUCT_INFO') {
      if (
        messageLower.includes('talle') ||
        messageLower.includes('size') ||
        messageLower.includes('medida')
      ) {
        return UseCaseType.CHECK_SIZE_AVAILABILITY;
      }
      if (messageLower.match(/\d+/)) {
        // Contains numbers (possibly product ID)
        return UseCaseType.GET_PRODUCT_DETAILS;
      }
      return UseCaseType.FIND_PRODUCT;
    }

    // STORE_INFO intent
    if (classifierIntent === 'STORE_INFO') {
      if (
        messageLower.includes('horario') ||
        messageLower.includes('hours') ||
        messageLower.includes('abierto')
      ) {
        return UseCaseType.GET_STORE_HOURS;
      }
      if (
        messageLower.includes('devolucion') ||
        messageLower.includes('cambio') ||
        messageLower.includes('politica')
      ) {
        return UseCaseType.LEARN_RETURN_POLICY;
      }
      if (
        messageLower.includes('contacto') ||
        messageLower.includes('telefono') ||
        messageLower.includes('email')
      ) {
        return UseCaseType.CONTACT_SUPPORT;
      }
      return UseCaseType.CONTACT_SUPPORT;
    }

    // OTHERS intent
    if (classifierIntent === 'OTHERS') {
      return UseCaseType.GREETING;
    }

    return null;
  }

  /**
   * Initialize steps for a use case
   */
  private initializeSteps(useCaseType: UseCaseType): UseCaseStep[] {
    const workflow = USE_CASE_WORKFLOWS[useCaseType];
    if (!workflow) return [];

    return workflow.requiredSteps.map((stepId) => ({
      stepId,
      description: this.getStepDescription(stepId),
      completed: false,
    }));
  }

  /**
   * Extract context from message (for old use case system)
   */
  private extractUseCaseContext(
    message: string,
    useCaseType: UseCaseType,
  ): Record<string, any> {
    const context: Record<string, any> = {};

    // Extract order number (e.g., "#1234", "1234", "SO1234")
    const orderMatch = message.match(/#?(\d+)/);
    if (
      orderMatch &&
      (useCaseType.includes('order') ||
        useCaseType.includes('track') ||
        useCaseType.includes('return') ||
        useCaseType.includes('payment'))
    ) {
      context.orderId = orderMatch[1];
    }

    // Extract size mentions
    const sizeMatch = message.match(/talle\s*(\d+)/i);
    if (sizeMatch) {
      context.requestedSize = sizeMatch[1];
    }

    // Extract product mentions (basic pattern matching)
    // Note: Real implementation should check conversation state for product context

    return context;
  }

  /**
   * Get human-readable step description
   */
  private getStepDescription(stepId: string): string {
    return STEP_DESCRIPTIONS[stepId] || stepId;
  }

  /**
   * Mark a step as completed
   */
  markStepCompleted(
    useCase: UseCase,
    stepId: string,
    data?: Record<string, any>,
  ): void {
    const step = useCase.steps.find((s) => s.stepId === stepId);
    if (step) {
      step.completed = true;
      step.completedAt = new Date();
      if (data) {
        step.data = data;
      }
      this.logger.debug(
        `Step completed: ${stepId} for use case ${useCase.type}`,
      );
    }
  }

  /**
   * Check if use case is completed
   */
  isUseCaseCompleted(useCase: UseCase): boolean {
    return useCase.steps.every((step) => step.completed);
  }

  /**
   * Get next incomplete step
   */
  getNextStep(useCase: UseCase): UseCaseStep | null {
    return useCase.steps.find((step) => !step.completed) || null;
  }

  /**
   * Get completion prompt for a use case type
   */
  getCompletionPrompt(useCaseType: UseCaseType): string {
    const prompts: Record<UseCaseType, string> = {
      [UseCaseType.CHECK_ORDER_STATUS]:
        '¿Hay algo más que pueda hacer por vos con este pedido?',
      [UseCaseType.TRACK_SHIPMENT]:
        '¿Necesitás ayuda con algo más sobre este envío?',
      [UseCaseType.REQUEST_RETURN]:
        '¿Necesitás ayuda con algo más sobre la devolución?',
      [UseCaseType.VERIFY_PAYMENT]:
        '¿Hay algo más que pueda ayudarte con el pago?',
      [UseCaseType.FIND_PRODUCT]:
        '¿Querés que te muestre más opciones o te ayudo con algo más?',
      [UseCaseType.CHECK_SIZE_AVAILABILITY]:
        '¿Querés que te ayude con algo más sobre este producto?',
      [UseCaseType.GET_PRODUCT_DETAILS]:
        '¿Necesitás saber algo más sobre este producto?',
      [UseCaseType.LEARN_RETURN_POLICY]:
        '¿Te quedó clara la política de devoluciones?',
      [UseCaseType.GET_STORE_HOURS]: '¿Puedo ayudarte con algo más?',
      [UseCaseType.CONTACT_SUPPORT]: '¿Necesitás ayuda con algo más?',
      [UseCaseType.GREETING]: '¿En qué puedo ayudarte hoy?',
      [UseCaseType.OTHER]: '¿Puedo ayudarte con algo más?',
    };

    return prompts[useCaseType] || '¿Puedo ayudarte con algo más?';
  }
}
