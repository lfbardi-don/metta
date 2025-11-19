import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import {
  ConversationState,
  CustomerGoal,
  GoalType,
} from '../../../common/interfaces/conversation-state.interface';

/**
 * Goal Detection Service
 *
 * Detects and manages customer goals.
 * This service:
 * - Detects goal type from message and classifier intent
 * - Creates new goals or continues existing ones
 * - Simplified: NO step tracking (removed brittle keyword matching)
 * - Focuses on WHAT the customer wants, not HOW we process it
 */
@Injectable()
export class GoalDetectionService {
  private readonly logger = new Logger(GoalDetectionService.name);

  /**
   * Detect customer goal from message and classifier intent
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
}
