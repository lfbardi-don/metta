import { Test, TestingModule } from '@nestjs/testing';
import { ProductExtractionService } from './product-extraction.service';

describe('ProductExtractionService', () => {
  let service: ProductExtractionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ProductExtractionService],
    }).compile();

    service = module.get<ProductExtractionService>(ProductExtractionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('extractProductsFromStructuredOutput', () => {
    it('should extract products from structured output', () => {
      const structuredProducts = [
        { id: 123, name: 'Test Product', confidence: 0.9 },
        { id: 456, name: 'Another Product' },
      ];

      const result =
        service.extractProductsFromStructuredOutput(structuredProducts);

      expect(result).toHaveLength(2);
      expect(result[0].productId).toBe(123);
      expect(result[0].productName).toBe('Test Product');
      expect(result[1].productId).toBe(456);
    });

    it('should return empty array if no products', () => {
      const result = service.extractProductsFromStructuredOutput([]);
      expect(result).toHaveLength(0);
    });
  });

  describe('extractProductsFromToolCalls', () => {
    it('should extract products from search_nuvemshop_products tool call', () => {
      const newItems = [
        {
          type: 'tool_call_item',
          rawItem: {
            name: 'mcp_call',
            providerData: { name: 'search_nuvemshop_products' },
            output: JSON.stringify([{ id: 101, name: 'Search Result' }]),
          },
        },
      ];

      const result = service.extractProductsFromToolCalls(newItems);

      expect(result).toHaveLength(1);
      expect(result[0].productId).toBe(101);
      expect(result[0].productName).toBe('Search Result');
      expect(result[0].context).toBe('search');
    });

    it('should extract products from get_nuvemshop_product tool call', () => {
      const newItems = [
        {
          type: 'tool_call_item',
          rawItem: {
            name: 'mcp_call',
            providerData: { name: 'get_nuvemshop_product' },
            output: JSON.stringify({ id: 202, name: 'Get Result' }),
          },
        },
      ];

      const result = service.extractProductsFromToolCalls(newItems);

      expect(result).toHaveLength(1);
      expect(result[0].productId).toBe(202);
      expect(result[0].productName).toBe('Get Result');
      expect(result[0].context).toBe('question');
    });
  });
});
