import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter } from 'react-router';

import { SupabaseAccountService } from './account/supabaseAccountService';
import { App } from './App';
import { SupabaseAuthService } from './auth/supabaseAuthService';
import { SupabaseCaseRepository } from './data/supabaseCaseRepository';
import { createSupabaseClient } from './lib/supabaseClient';
import { readSupabaseConfig } from './lib/supabaseConfig';
import { ConfigurationErrorPage } from './pages/ConfigurationErrorPage';
import { SupabasePhotoStore } from './photos/supabasePhotoStore';
import { routes } from './routes';
import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';

const root = createRoot(document.getElementById('root')!);
const result = readSupabaseConfig(import.meta.env);

if (!result.ok) {
  root.render(
    <StrictMode>
      <ConfigurationErrorPage reason={result.reason} />
    </StrictMode>,
  );
} else {
  const { config } = result;
  const client = createSupabaseClient(config);
  // Created before anything else reads the session, so a password-reset link
  // in the URL is recognised.
  const auth = new SupabaseAuthService(client, `${window.location.origin}/reset-password`);
  const onSessionExpired = () => auth.handleSessionExpired();
  const services = {
    auth,
    repository: new SupabaseCaseRepository(client, onSessionExpired),
    photos: new SupabasePhotoStore(client, config.url, config.publishableKey, { onSessionExpired }),
    account: new SupabaseAccountService(client),
  };
  const router = createBrowserRouter(routes);

  root.render(
    <StrictMode>
      <App services={services} router={router} />
    </StrictMode>,
  );
}
