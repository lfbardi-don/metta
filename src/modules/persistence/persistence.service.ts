import { Injectable, Logger } from '@nestjs/common';
import {
  IncomingMessage,
  OutgoingMessage,
  ConversationState,
  ProductMention,
  CustomerGoal,
} from '../../common/interfaces';
import { PrismaService } from './prisma.service';

/**
 * PersistenceService handles saving and retrieving messages and conversation data.
 * This data serves dual purposes:
 * 1. Audit trail for compliance and debugging
 * 2. Source of truth for AI conversation history (stateless agent retrieves from DB)
 */
@Injectable()
export class PersistenceService {
  private readonly logger = new Logger(PersistenceService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Save an incoming message to the database
   */
  async saveIncomingMessage(message: IncomingMessage): Promise<void> {
    try {
      // Ensure conversation exists
      await this.prisma.conversation.upsert({
        where: { id: message.conversationId },
        update: {},
        create: {
          id: message.conversationId,
          metadata: message.metadata.conversation || {},
        },
      });

      // Create message record
      await this.prisma.message.create({
        data: {
          conversationId: message.conversationId,
          messageId: message.messageId,
          contactId: message.contactId,
          content: message.content,
          direction: 'incoming',
          messageType: 'text',
          metadata: message.metadata,
          createdAt: message.timestamp,
        },
      });

      this.logger.log('Saved incoming message', {
        messageId: message.messageId,
        conversationId: message.conversationId,
      });
    } catch (error) {
      this.logger.error('Failed to save incoming message', {
        error: error.message,
        messageId: message.messageId,
      });
      // Don't throw - persistence failure shouldn't block message processing
    }
  }

  /**
   * Save an outgoing message to the database
   */
  async saveOutgoingMessage(message: OutgoingMessage): Promise<void> {
    try {
      // Ensure conversation exists
      await this.prisma.conversation.upsert({
        where: { id: message.conversationId },
        update: {},
        create: {
          id: message.conversationId,
        },
      });

      // Create message record
      await this.prisma.message.create({
        data: {
          conversationId: message.conversationId,
          content: message.content,
          direction: 'outgoing',
          messageType: message.messageType,
          metadata: message.metadata || {},
        },
      });

      this.logger.log('Saved outgoing message', {
        conversationId: message.conversationId,
      });
    } catch (error) {
      this.logger.error('Failed to save outgoing message', {
        error: error.message,
        conversationId: message.conversationId,
      });
      // Don't throw - persistence failure shouldn't block message processing
    }
  }

  /**
   * Update an incoming message's metadata with conversation state
   * Called after AI processing to add state to the incoming message
   */
  async updateIncomingMessageMetadata(
    conversationId: string,
    messageId: string,
    metadata: any,
  ): Promise<void> {
    try {
      await this.prisma.message.updateMany({
        where: {
          conversationId,
          messageId,
          direction: 'incoming',
        },
        data: {
          metadata,
        },
      });

      this.logger.log('Updated incoming message metadata', {
        messageId,
        conversationId,
      });
    } catch (error) {
      this.logger.error('Failed to update incoming message metadata', {
        error: error.message,
        messageId,
      });
      // Don't throw - metadata update failure shouldn't block processing
    }
  }

  /**
   * Save conversation metadata
   */
  async saveConversationMetadata(
    conversationId: string,
    metadata: Record<string, any>,
  ): Promise<void> {
    // TODO: Implement Prisma upsert operation
    this.logger.log('Saving conversation metadata', { conversationId });
  }

  /**
   * Get messages by conversation ID
   * Returns messages in chronological order for AI context
   *
   * @param conversationId - The conversation ID
   * @param options - Optional query options
   * @param options.excludeLatest - Exclude N most recent messages (useful to avoid duplication)
   */
  async getMessagesByConversation(
    conversationId: string,
    options?: { excludeLatest?: number },
  ): Promise<any[]> {
    try {
      const messages = await this.prisma.message.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          content: true,
          direction: true,
          createdAt: true,
        },
      });

      // Exclude latest N messages if requested
      const filteredMessages =
        options?.excludeLatest && options.excludeLatest > 0
          ? messages.slice(0, -options.excludeLatest)
          : messages;

      this.logger.log('Retrieved conversation history', {
        conversationId,
        totalMessages: messages.length,
        returnedMessages: filteredMessages.length,
        excludedLatest: options?.excludeLatest || 0,
      });

      return filteredMessages;
    } catch (error) {
      this.logger.error('Failed to retrieve conversation history', {
        error: error.message,
        conversationId,
      });
      // Return empty array on error - allows conversation to continue without history
      return [];
    }
  }

  /**
   * Get conversation metadata
   */
  async getConversationMetadata(conversationId: string): Promise<any> {
    // TODO: Implement Prisma query
    this.logger.log('Getting conversation metadata', { conversationId });
    return null;
  }

  /**
   * Get conversation state (product context tracking)
   * Returns null if no state exists or on error (to allow conversation to continue)
   *
   * @param conversationId - The conversation ID
   * @returns ConversationState or null
   */
  async getConversationState(
    conversationId: string,
  ): Promise<ConversationState | null> {
    try {
      const state = await this.prisma.conversationState.findUnique({
        where: { conversationId },
      });

      if (!state) return null;

      // Prisma automatically deserializes JSON - just need type assertion
      const stateData = (state.state || { products: [] }) as unknown as {
        products: ProductMention[];
      };

      this.logger.log('Retrieved conversation state', {
        conversationId,
        hasState: true,
        productsCount: stateData.products.length,
      });

      return {
        ...state,
        state: stateData,
      };
    } catch (error) {
      this.logger.error('Failed to retrieve conversation state', {
        error: error.message,
        conversationId,
      });
      // Return null on error - allow conversation to continue without state
      return null;
    }
  }

  /**
   * Update conversation state with product mentions
   * Upserts state (creates if doesn't exist, updates if exists)
   * Merges new products with existing ones (deduplicates by productId)
   *
   * @param conversationId - The conversation ID
   * @param newProducts - Array of new product mentions to add
   */
  async updateConversationState(
    conversationId: string,
    newProducts: ProductMention[],
  ): Promise<void> {
    try {
      // First, check if state exists
      const existingState = await this.prisma.conversationState.findUnique({
        where: { conversationId },
      });

      // Merge products (deduplicate by productId)
      let mergedProducts: ProductMention[] = [];

      if (existingState?.state) {
        // Prisma automatically deserializes JSON - just need type assertion
        const stateData = existingState.state as unknown as {
          products: ProductMention[];
        };
        const existingProducts = stateData.products || [];
        const existingIds = new Set(existingProducts.map((p) => p.productId));

        // Keep existing products and add only new ones
        mergedProducts = [
          ...existingProducts,
          ...newProducts.filter((p) => !existingIds.has(p.productId)),
        ];
      } else {
        mergedProducts = newProducts;
      }

      // Build new state object
      const newState = { products: mergedProducts };

      // Upsert state
      await this.prisma.conversationState.upsert({
        where: { conversationId },
        update: {
          state: newState as any, // Prisma Json type
        },
        create: {
          conversationId,
          state: newState as any, // Prisma Json type
        },
      });

      this.logger.log('Updated conversation state', {
        conversationId,
        newProductsCount: newProducts.length,
        totalProductsCount: mergedProducts.length,
        newProductIds: newProducts.map((p) => p.productId),
      });
    } catch (error) {
      this.logger.error('Failed to update conversation state', {
        error: error.message,
        conversationId,
        newProductsCount: newProducts.length,
      });
      // Don't throw - state update failure shouldn't block message processing
    }
  }

  /**
   * Update full conversation state (NEW - supports goals, products, summary)
   * More flexible than updateConversationState - allows updating any state field
   *
   * @param conversationId - The conversation ID
   * @param stateUpdate - Partial state update (any fields to update)
   */
  async updateFullConversationState(
    conversationId: string,
    stateUpdate: Partial<ConversationState['state']>,
  ): Promise<void> {
    try {
      // Get existing state
      const existingState = await this.prisma.conversationState.findUnique({
        where: { conversationId },
      });

      // Merge with existing state
      const currentState = existingState?.state
        ? (existingState.state as any)
        : { products: [] };

      const newState = {
        ...currentState,
        ...stateUpdate,
        // Merge products if provided
        products: stateUpdate.products || currentState.products || [],
      };

      // Upsert state
      await this.prisma.conversationState.upsert({
        where: { conversationId },
        update: {
          state: newState as any,
        },
        create: {
          conversationId,
          state: newState as any,
        },
      });

      this.logger.log('Updated full conversation state', {
        conversationId,
        updatedFields: Object.keys(stateUpdate),
      });
    } catch (error) {
      this.logger.error('Failed to update full conversation state', {
        error: error.message,
        conversationId,
      });
    }
  }

  /**
   * Set active goal for conversation
   *
   * @param conversationId - The conversation ID
   * @param goal - The new active goal (null to clear)
   */
  async setActiveGoal(
    conversationId: string,
    goal: CustomerGoal | null,
  ): Promise<void> {
    try {
      const existingState = await this.getConversationState(conversationId);
      const currentState = existingState?.state || { products: [] };

      // If setting a new goal and there's an active one, move it to recent
      let recentGoals = currentState.recentGoals || [];
      if (goal && currentState.activeGoal) {
        const completedGoal = {
          ...currentState.activeGoal,
          status: 'completed' as const,
          completedAt: new Date(),
        };
        recentGoals = [completedGoal, ...recentGoals].slice(0, 3); // Keep last 3
      }

      await this.updateFullConversationState(conversationId, {
        activeGoal: goal,
        recentGoals,
        lastTopic: goal?.context?.topic,
      });

      this.logger.log('Set active goal', {
        conversationId,
        goalType: goal?.type,
        goalId: goal?.goalId,
      });
    } catch (error) {
      this.logger.error('Failed to set active goal', {
        error: error.message,
        conversationId,
      });
    }
  }

  /**
   * Update active goal's progress
   *
   * @param conversationId - The conversation ID
   * @param updates - Fields to update on the active goal
   */
  async updateActiveGoal(
    conversationId: string,
    updates: Partial<CustomerGoal>,
  ): Promise<void> {
    try {
      const existingState = await this.getConversationState(conversationId);
      if (!existingState?.state?.activeGoal) {
        this.logger.warn('No active goal to update', { conversationId });
        return;
      }

      const updatedGoal = {
        ...existingState.state.activeGoal,
        ...updates,
        lastActivityAt: new Date(),
      };

      await this.updateFullConversationState(conversationId, {
        activeGoal: updatedGoal as CustomerGoal,
      });

      this.logger.log('Updated active goal', {
        conversationId,
        goalId: updatedGoal.goalId,
        updatedFields: Object.keys(updates),
      });
    } catch (error) {
      this.logger.error('Failed to update active goal', {
        error: error.message,
        conversationId,
      });
    }
  }

  /**
   * Add progress marker to active goal
   *
   * @param conversationId - The conversation ID
   * @param marker - Progress marker to add (e.g., "authenticated", "order_fetched")
   */
  async addGoalProgressMarker(
    conversationId: string,
    marker: string,
  ): Promise<void> {
    try {
      const existingState = await this.getConversationState(conversationId);
      if (!existingState?.state?.activeGoal) {
        return;
      }

      const currentMarkers =
        existingState.state.activeGoal.progressMarkers || [];
      if (currentMarkers.includes(marker)) {
        return; // Already exists
      }

      await this.updateActiveGoal(conversationId, {
        progressMarkers: [...currentMarkers, marker],
      });

      this.logger.log('Added goal progress marker', {
        conversationId,
        marker,
      });
    } catch (error) {
      this.logger.error('Failed to add goal progress marker', {
        error: error.message,
        conversationId,
        marker,
      });
    }
  }

  /**
   * Complete active goal and move to recent goals
   *
   * @param conversationId - The conversation ID
   */
  async completeActiveGoal(conversationId: string): Promise<void> {
    try {
      const existingState = await this.getConversationState(conversationId);
      if (!existingState?.state?.activeGoal) {
        return;
      }

      const completedGoal: CustomerGoal = {
        ...existingState.state.activeGoal,
        status: 'completed',
        completedAt: new Date(),
      };

      const recentGoals = [
        completedGoal,
        ...(existingState.state.recentGoals || []),
      ].slice(0, 3);

      await this.updateFullConversationState(conversationId, {
        activeGoal: null,
        recentGoals,
      });

      this.logger.log('Completed active goal', {
        conversationId,
        goalId: completedGoal.goalId,
        goalType: completedGoal.type,
      });
    } catch (error) {
      this.logger.error('Failed to complete active goal', {
        error: error.message,
        conversationId,
      });
    }
  }

  /**
   * Update conversation summary
   *
   * @param conversationId - The conversation ID
   * @param summary - Human-readable summary (max 200 chars recommended)
   */
  async updateSummary(
    conversationId: string,
    summary: string,
  ): Promise<void> {
    try {
      await this.updateFullConversationState(conversationId, {
        summary: summary.substring(0, 200), // Enforce max length
      });

      this.logger.log('Updated conversation summary', {
        conversationId,
        summaryLength: summary.length,
      });
    } catch (error) {
      this.logger.error('Failed to update summary', {
        error: error.message,
        conversationId,
      });
    }
  }

  /**
   * Set escalation flag
   *
   * @param conversationId - The conversation ID
   * @param reason - Reason for escalation
   */
  async setEscalation(
    conversationId: string,
    reason: string,
  ): Promise<void> {
    try {
      await this.updateFullConversationState(conversationId, {
        needsHumanHelp: true,
        escalationReason: reason,
      });

      this.logger.warn('Conversation escalated', {
        conversationId,
        reason,
      });
    } catch (error) {
      this.logger.error('Failed to set escalation', {
        error: error.message,
        conversationId,
      });
    }
  }

  /**
   * Clear escalation flag
   *
   * @param conversationId - The conversation ID
   */
  async clearEscalation(conversationId: string): Promise<void> {
    try {
      await this.updateFullConversationState(conversationId, {
        needsHumanHelp: false,
        escalationReason: undefined,
      });

      this.logger.log('Cleared escalation', { conversationId });
    } catch (error) {
      this.logger.error('Failed to clear escalation', {
        error: error.message,
        conversationId,
      });
    }
  }
}
