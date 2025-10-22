import { Module } from '@nestjs/common';
import { GuardrailsService } from './guardrails.service';
import { ProfessionalToneGuardrail } from './professional-tone.guardrail';
import { ResponseRelevanceGuardrail } from './response-relevance.guardrail';

@Module({
  providers: [
    GuardrailsService,
    ProfessionalToneGuardrail,
    ResponseRelevanceGuardrail,
  ],
  exports: [GuardrailsService],
})
export class GuardrailsModule {}
