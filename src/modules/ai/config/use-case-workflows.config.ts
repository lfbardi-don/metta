import { UseCaseType } from '../../../common/interfaces/use-case.interface';

/**
 * Use Case Workflow Configuration
 *
 * Defines the required steps, allowed agents, and instructions for each use case type.
 */
export interface UseCaseWorkflow {
  type: UseCaseType;
  requiredSteps: string[]; // Step IDs that must be completed
  allowedAgents: string[]; // Which agents can handle this
  completionCriteria: string; // Description of completion
  instructions: string; // Special instructions for agent
}

/**
 * Use Case Workflow Definitions
 *
 * Maps each use case type to its workflow configuration.
 */
export const USE_CASE_WORKFLOWS: Record<UseCaseType, UseCaseWorkflow> = {
  [UseCaseType.CHECK_ORDER_STATUS]: {
    type: UseCaseType.CHECK_ORDER_STATUS,
    requiredSteps: [
      'authenticate',
      'fetch_status',
      'present_status',
    ],
    allowedAgents: ['Orders Agent'],
    completionCriteria: 'Customer has received order status information',
    instructions: `
Steps to complete this use case:
1. Authenticate customer (verify DNI)
2. Fetch last order using get_last_order(conversationId)
3. Present status clearly (tracking info is in fulfillments array)
4. Ask: "¿Hay algo más que pueda hacer por vos con este pedido?"
Note: Only the most recent order is available. For order history, direct to metta.com.ar
    `.trim(),
  },

  [UseCaseType.TRACK_SHIPMENT]: {
    type: UseCaseType.TRACK_SHIPMENT,
    requiredSteps: [
      'authenticate',
      'fetch_tracking',
      'present_tracking',
    ],
    allowedAgents: ['Orders Agent'],
    completionCriteria: 'Customer has received tracking information',
    instructions: `
Steps to complete this use case:
1. Authenticate customer
2. Fetch last order using get_last_order(conversationId)
3. Extract tracking from fulfillments array (trackingCode, carrier, trackingUrl)
4. Present tracking number and status
5. Ask: "¿Necesitás ayuda con algo más sobre este envío?"
    `.trim(),
  },

  [UseCaseType.REQUEST_RETURN]: {
    type: UseCaseType.REQUEST_RETURN,
    requiredSteps: [
      'authenticate',
      'fetch_order',
      'verify_eligibility',
      'provide_instructions',
    ],
    allowedAgents: ['Orders Agent'],
    completionCriteria: 'Customer has received return instructions',
    instructions: `
Steps to complete this use case:
1. Authenticate customer
2. Fetch last order using get_last_order(conversationId)
3. Verify return eligibility (within 30 days, check order date)
4. Provide return instructions
5. Ask: "¿Necesitás ayuda con algo más sobre la devolución?"
    `.trim(),
  },

  [UseCaseType.VERIFY_PAYMENT]: {
    type: UseCaseType.VERIFY_PAYMENT,
    requiredSteps: [
      'authenticate',
      'fetch_payment',
      'present_payment',
    ],
    allowedAgents: ['Orders Agent'],
    completionCriteria: 'Customer has received payment information',
    instructions: `
Steps to complete this use case:
1. Authenticate customer
2. Fetch last order using get_last_order(conversationId)
3. Extract payment info (paymentStatus, paymentMethod, gateway)
4. Present payment status and method
5. Ask: "¿Hay algo más que pueda ayudarte con el pago?"
Note: Detailed payment history is not available. For transaction details, direct to website.
    `.trim(),
  },

  [UseCaseType.FIND_PRODUCT]: {
    type: UseCaseType.FIND_PRODUCT,
    requiredSteps: [
      'understand_need',
      'search_products',
      'present_products',
      'check_satisfaction',
    ],
    allowedAgents: ['Products Agent'],
    completionCriteria:
      'Customer has seen relevant products and confirmed satisfaction',
    instructions: `
Steps to complete this use case:
1. Understand what customer is looking for
2. Search products using search_nuvemshop_products()
3. Present top 3 products in card format
4. Ask: "¿Querés que te muestre más opciones o te ayudo con algo más?"
    `.trim(),
  },

  [UseCaseType.CHECK_SIZE_AVAILABILITY]: {
    type: UseCaseType.CHECK_SIZE_AVAILABILITY,
    requiredSteps: [
      'identify_product',
      'check_variants',
      'present_availability',
    ],
    allowedAgents: ['Products Agent'],
    completionCriteria: 'Customer has received size availability information',
    instructions: `
Steps to complete this use case:
1. Identify which product (from context or ask)
2. Check variant availability using get_nuvemshop_product_by_id()
3. Present available sizes with stock status
4. Ask: "¿Querés que te ayude con algo más sobre este producto?"
    `.trim(),
  },

  [UseCaseType.GET_PRODUCT_DETAILS]: {
    type: UseCaseType.GET_PRODUCT_DETAILS,
    requiredSteps: ['identify_product', 'fetch_details', 'present_details'],
    allowedAgents: ['Products Agent'],
    completionCriteria: 'Customer has received detailed product information',
    instructions: `
Steps to complete this use case:
1. Identify which product (from context or ID)
2. Fetch product details using get_nuvemshop_product_by_id()
3. Present details (price, description, variants, stock)
4. Ask: "¿Necesitás saber algo más sobre este producto?"
    `.trim(),
  },

  [UseCaseType.LEARN_RETURN_POLICY]: {
    type: UseCaseType.LEARN_RETURN_POLICY,
    requiredSteps: ['search_policy', 'present_policy', 'confirm_understanding'],
    allowedAgents: ['FAQ Agent'],
    completionCriteria: 'Customer understands the return policy',
    instructions: `
Steps to complete this use case:
1. Search knowledge base for return policy
2. Present policy clearly (30 days, conditions)
3. Ask: "¿Te quedó clara la política de devoluciones?"
    `.trim(),
  },

  [UseCaseType.GET_STORE_HOURS]: {
    type: UseCaseType.GET_STORE_HOURS,
    requiredSteps: ['search_hours', 'present_hours'],
    allowedAgents: ['FAQ Agent'],
    completionCriteria: 'Customer has received store hours information',
    instructions: `
Steps to complete this use case:
1. Search knowledge base for store hours
2. Present hours clearly
3. Ask: "¿Puedo ayudarte con algo más?"
    `.trim(),
  },

  [UseCaseType.CONTACT_SUPPORT]: {
    type: UseCaseType.CONTACT_SUPPORT,
    requiredSteps: ['search_contact', 'present_contact'],
    allowedAgents: ['FAQ Agent'],
    completionCriteria: 'Customer has received contact information',
    instructions: `
Steps to complete this use case:
1. Search knowledge base for contact methods
2. Present all contact options (email, phone, WhatsApp)
3. Ask: "¿Necesitás ayuda con algo más?"
    `.trim(),
  },

  [UseCaseType.GREETING]: {
    type: UseCaseType.GREETING,
    requiredSteps: ['respond_greeting', 'offer_help'],
    allowedAgents: ['Greetings Agent'],
    completionCriteria: 'Customer has been greeted and offered assistance',
    instructions: `
Steps to complete this use case:
1. Respond to greeting warmly
2. Offer help: "¿En qué puedo ayudarte hoy?"
    `.trim(),
  },

  [UseCaseType.OTHER]: {
    type: UseCaseType.OTHER,
    requiredSteps: ['understand_query', 'provide_response'],
    allowedAgents: [
      'Orders Agent',
      'Products Agent',
      'FAQ Agent',
      'Greetings Agent',
    ],
    completionCriteria: 'Customer query has been addressed',
    instructions: `
Steps to complete this use case:
1. Understand what customer needs
2. Provide appropriate response
3. Ask: "¿Puedo ayudarte con algo más?"
    `.trim(),
  },
};

/**
 * Step Descriptions
 *
 * Human-readable descriptions for common workflow steps.
 */
export const STEP_DESCRIPTIONS: Record<string, string> = {
  // Authentication
  authenticate: 'Verify customer identity',

  // Order steps
  identify_order: 'Identify which order',
  fetch_status: 'Fetch order status',
  present_status: 'Present status to customer',
  fetch_tracking: 'Fetch tracking information',
  present_tracking: 'Present tracking details',
  fetch_payment: 'Fetch payment details',
  present_payment: 'Present payment information',
  verify_eligibility: 'Verify return eligibility',
  provide_instructions: 'Provide return instructions',

  // Product steps
  understand_need: 'Understand customer need',
  search_products: 'Search for products',
  present_products: 'Present products',
  check_satisfaction: 'Confirm customer satisfaction',
  identify_product: 'Identify which product',
  check_variants: 'Check variant availability',
  present_availability: 'Present availability information',
  fetch_details: 'Fetch product details',
  present_details: 'Present product details',

  // FAQ steps
  search_policy: 'Search return policy',
  present_policy: 'Present policy information',
  confirm_understanding: 'Confirm understanding',
  search_hours: 'Search store hours',
  present_hours: 'Present store hours',
  search_contact: 'Search contact information',
  present_contact: 'Present contact details',

  // General steps
  respond_greeting: 'Respond to greeting',
  offer_help: 'Offer assistance',
  understand_query: 'Understand customer query',
  provide_response: 'Provide response',
};
