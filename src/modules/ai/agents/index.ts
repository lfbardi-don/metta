// Classifier
export {
  mettaClassifier,
  MettaClassifierSchema,
  type MettaClassifierOutput,
} from './classifier.agent';

// Dynamic agent factories (all agents now support customer name from state)
export { createFaqAgent, faqAgent } from './faq.agent';
export { createGreetingsAgent, greetingsAgent } from './greetings.agent';
export { createHandoffAgent, handoffAgent } from './handoff.agent';
export { createOrdersAgent } from './orders.agent';
export { createProductsAgent } from './products.agent';
export { createExchangeAgent, inferNextExchangeStep } from './exchange.agent';
