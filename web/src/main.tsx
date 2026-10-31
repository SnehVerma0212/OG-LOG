import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter } from 'react-router';

import { App } from './App';
import { InMemoryCaseRepository } from './data/inMemoryCaseRepository';
import { sampleCases } from './data/sampleCases';
import { routes } from './routes';
import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';

// Phase 1: an in-memory repository seeded with synthetic sample cases.
const repository = new InMemoryCaseRepository(sampleCases(new Date()));
const router = createBrowserRouter(routes);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App repository={repository} router={router} />
  </StrictMode>,
);
