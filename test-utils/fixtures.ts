import type { CaseInput } from '../src/domain/cases';

// Synthetic, non-identifying test data only. Never use real patient information here.
export function caseInput(overrides: Partial<CaseInput> = {}): CaseInput {
  return {
    reference: '',
    surgeryDate: '2026-10-15',
    procedure: 'Laparoscopic cholecystectomy',
    diagnosis: 'Symptomatic cholelithiasis',
    role: 'primary',
    status: 'draft',
    sections: { preop: {}, ot: {}, postop: {} },
    ...overrides,
  };
}
