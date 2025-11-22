import { Injectable, Logger } from '@nestjs/common';
import {
    SimplifiedSQSMessage,
    fromSimplifiedSQS,
    IncomingMessage,
} from '../../../common/interfaces';
import { WorkflowAIService } from '../../ai/workflow-ai.service';
import { ChatwootService } from '../../integrations/chatwoot/chatwoot.service';
import { PersistenceService } from '../../persistence/persistence.service';

@Injectable()
export class MessageProcessorService {
    private readonly logger = new Logger(MessageProcessorService.name);

    constructor(
        private readonly workflowAIService: WorkflowAIService,
        private readonly chatwootService: ChatwootService,
        private readonly persistenceService: PersistenceService,
    ) { }

    /**
     * Process a batch of messages for a specific conversation
     * 
     * Handles:
     * 1. Conversion to internal message format
     * 2. Persistence of incoming messages
     * 3. AI processing
     * 4. Sending response to Chatwoot
     * 5. Persistence of outgoing response
     */
    async processMessageBatch(
        conversationId: string,
        messages: SimplifiedSQSMessage[],
    ): Promise<void> {
        const batchSize = messages.length;
        this.logger.log(
            `Processing batch of ${batchSize} message(s) for conversation ${conversationId}`,
        );

        try {
            // 1. Convert all messages to IncomingMessage format
            const incomingMessages: IncomingMessage[] = messages.map((msg) =>
                fromSimplifiedSQS(msg),
            );

            // 2. Save all incoming messages to persistence (audit log)
            for (const incomingMessage of incomingMessages) {
                await this.persistenceService.saveIncomingMessage(incomingMessage);
            }

            // 3. Process with Workflow AI
            this.logger.log('Processing batch with Workflow AI service');
            // We process the last message in the batch as the "trigger", but the AI service
            // will load the full conversation history from DB (which now includes the messages we just saved)
            const { response, products, metadata, initialState } =
                await this.workflowAIService.processMessage(
                    incomingMessages[incomingMessages.length - 1],
                );

            // Log product count for debugging
            if (products.length > 0) {
                this.logger.log(
                    `AI returned ${products.length} product(s) - formatted inline with images`,
                );
            }

            // 3.5. Update incoming message with INITIAL state (before processing)
            // This captures the state at the moment the user sent their message
            const latestIncomingMessage = incomingMessages[incomingMessages.length - 1];
            if (latestIncomingMessage.messageId && initialState) {
                const updatedMetadata = {
                    ...latestIncomingMessage.metadata, // Keep source, accountId, etc.
                    state: initialState,                // Initial state (use case just detected)
                };

                await this.persistenceService.updateIncomingMessageMetadata(
                    conversationId,
                    latestIncomingMessage.messageId,
                    updatedMetadata,
                );
            }

            // 4. Send AI response (text with inline markdown images)
            // AI automatically formats products using card-style template with ![alt](url) syntax
            this.logger.log('Sending response to Chatwoot');
            const outgoingMessage = {
                conversationId,
                content: response,
                messageType: 'text' as const,
                metadata,
            };
            await this.chatwootService.sendMessage(outgoingMessage);

            // 5. Save outgoing message to persistence (audit log)
            await this.persistenceService.saveOutgoingMessage(outgoingMessage);

            this.logger.log(
                `Successfully processed batch logic for conversation ${conversationId}`,
            );
        } catch (error) {
            this.logger.error('Error in message processor service', {
                error: error.message,
                stack: error.stack,
                conversationId,
            });
            throw error;
        } finally {
            // Stop typing indicator when processing completes (success or failure)
            this.chatwootService.setTypingStatus(conversationId, false);
        }
    }
}
