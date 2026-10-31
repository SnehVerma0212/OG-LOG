import type { CaseInput } from '@og-log/domain/cases';
import { toISODate } from '@og-log/domain/dates';

// SYNTHETIC SAMPLE DATA for demonstrating the layout. These are not real
// patients or real operations, and contain no identifying information.
// Every reference starts with "SAMPLE-" so they are recognisable in the UI.

const daysAgo = (today: Date, days: number) =>
  toISODate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - days));

export function sampleCases(today: Date): CaseInput[] {
  return [
    {
      reference: 'SAMPLE-001',
      surgeryDate: daysAgo(today, 2),
      procedure: 'Laparoscopic cholecystectomy',
      diagnosis: 'Symptomatic cholelithiasis',
      role: 'primary',
      status: 'completed',
      sections: {
        preop: { indication: 'Sample text: recurrent biliary colic.', asaGrade: 'ASA II' },
        ot: { anaesthesia: 'General anaesthesia', duration: '70 minutes', findings: 'Sample text: no complications noted.' },
        postop: { course: 'Sample text: uneventful recovery.', lengthOfStay: '1 day' },
      },
    },
    {
      reference: 'SAMPLE-002',
      surgeryDate: daysAgo(today, 9),
      procedure: 'Inguinal hernia repair',
      diagnosis: 'Right inguinal hernia',
      role: 'assistant',
      status: 'completed',
      sections: {
        preop: { indication: 'Sample text: reducible swelling.' },
        ot: { anaesthesia: 'Spinal anaesthesia', technique: 'Sample text: open mesh repair.' },
        postop: { followUp: 'Sample text: review at two weeks.' },
      },
    },
    {
      reference: 'SAMPLE-003',
      surgeryDate: daysAgo(today, 20),
      procedure: 'Appendicectomy',
      diagnosis: 'Acute appendicitis',
      role: 'primary',
      status: 'draft',
      sections: { preop: { indication: 'Sample text: right iliac fossa pain.' }, ot: {}, postop: {} },
    },
    {
      reference: 'SAMPLE-004',
      surgeryDate: daysAgo(today, 41),
      procedure: 'Laparoscopic cholecystectomy',
      diagnosis: 'Gallbladder polyp',
      role: 'supervisor',
      status: 'completed',
      sections: { preop: {}, ot: { duration: '55 minutes' }, postop: { lengthOfStay: 'Day case' } },
    },
    {
      reference: 'SAMPLE-005',
      surgeryDate: daysAgo(today, 76),
      procedure: 'Excision of lipoma',
      diagnosis: '',
      role: null,
      status: 'draft',
      sections: { preop: {}, ot: {}, postop: {} },
    },
  ];
}
