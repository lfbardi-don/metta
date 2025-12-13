import { Test, TestingModule } from '@nestjs/testing';
import { MessageProcessorService } from './message-processor.service';
import { WorkflowAIService } from '../../ai/workflow-ai.service';
import { ChatwootService } from '../../integrations/chatwoot/chatwoot.service';
import { PersistenceService } from '../../persistence/persistence.service';
import { SimplifiedSQSMessage } from '../../../common/interfaces';

// Mock the WorkflowAIService to avoid importing its dependencies (like uuid) which cause ESM issues in Jest
jest.mock('../../ai/workflow-ai.service', () => {
  return {
    WorkflowAIService: class {
      processMessage = jest.fn();
    },
  };
});

describe('MessageProcessorService', () => {
  let service: MessageProcessorService;
  let workflowAIService: WorkflowAIService;
  let chatwootService: ChatwootService;
  let persistenceService: PersistenceService;

  const mockWorkflowAIService = {
    processMessage: jest.fn(),
  };
  const mockChatwootService = {
    sendMessage: jest.fn(),
    setTypingStatus: jest.fn(),
  };
  const mockPersistenceService = {
    saveIncomingMessage: jest.fn(),
    updateIncomingMessageMetadata: jest.fn(),
    saveOutgoingMessage: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessageProcessorService,
        { provide: WorkflowAIService, useValue: mockWorkflowAIService },
        { provide: ChatwootService, useValue: mockChatwootService },
        { provide: PersistenceService, useValue: mockPersistenceService },
      ],
    }).compile();

    service = module.get<MessageProcessorService>(MessageProcessorService);
    workflowAIService = module.get<WorkflowAIService>(WorkflowAIService);
    chatwootService = module.get<ChatwootService>(ChatwootService);
    persistenceService = module.get<PersistenceService>(PersistenceService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('processMessageBatch', () => {
    const mockMessages: SimplifiedSQSMessage[] = [
      {
        messageId: 'msg-1',
        conversationId: 'conv-1',
        userText: 'Hello',
        customerId: 'cust-1',
        accountId: 'acc-1',
      },
    ];

    it('should process a batch of messages successfully', async () => {
      // Mock AI response
      mockWorkflowAIService.processMessage.mockResolvedValue({
        response: 'Hello back',
        products: [],
        metadata: {},
        initialState: { products: [] },
      });

      await service.processMessageBatch('conv-1', mockMessages);

      // Verify persistence calls
      expect(persistenceService.saveIncomingMessage).toHaveBeenCalledTimes(1);
      expect(
        persistenceService.updateIncomingMessageMetadata,
      ).toHaveBeenCalled();
      expect(persistenceService.saveOutgoingMessage).toHaveBeenCalledTimes(1);

      // Verify AI call
      expect(workflowAIService.processMessage).toHaveBeenCalledTimes(1);

      // Verify Chatwoot call
      expect(chatwootService.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'conv-1',
          content: 'Hello back',
        }),
      );

      // Verify typing status cleared
      expect(chatwootService.setTypingStatus).toHaveBeenCalledWith(
        'conv-1',
        false,
      );
    });

    it('should handle errors and rethrow', async () => {
      mockWorkflowAIService.processMessage.mockRejectedValue(
        new Error('AI Error'),
      );

      await expect(
        service.processMessageBatch('conv-1', mockMessages),
      ).rejects.toThrow('AI Error');

      // Verify typing status still cleared
      expect(chatwootService.setTypingStatus).toHaveBeenCalledWith(
        'conv-1',
        false,
      );
    });
  });
});
