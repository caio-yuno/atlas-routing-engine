import { AcquirerConfig } from '../models/types';

export const acquirers: AcquirerConfig[] = [
  {
    name: 'Acquirer A',
    takeRate: 2.8,
    enabled: true,
    description: 'General purpose acquirer with balanced performance across all segments',
  },
  {
    name: 'Acquirer B',
    takeRate: 3.1,
    enabled: true,
    description: 'Strong performance for MX credit card transactions, higher take rate',
  },
  {
    name: 'Acquirer C',
    takeRate: 2.1,
    enabled: true,
    description: 'Cheapest acquirer, weaker approval rates on high-value transactions',
  },
];
