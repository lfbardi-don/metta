import { z } from 'zod';

export const AIResponseSchema = z.object({
    user_intent: z.enum([
        'ORDER_STATUS',
        'PRODUCT_INFO',
        'STORE_INFO',
        'GREETING',
        'HUMAN_HANDOFF',
        'OTHERS',
    ]).describe('The detected intent of the user message'),

    response_text: z.string().describe('The natural language response to be sent to the user'),

    products: z.array(z.object({
        id: z.number().optional().describe('The unique identifier of the product if known'),
        name: z.string().describe('The name of the product'),
        confidence: z.number().min(0).max(1).describe('Confidence score that this is the correct product'),
    })).default([]).describe('List of products mentioned or recommended in the response'),

    thinking: z.string().optional().describe('Chain of thought or reasoning behind the response'),
});

export type AIResponse = z.infer<typeof AIResponseSchema>;
