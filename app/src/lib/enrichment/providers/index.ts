// Export all enrichment providers

export { PdlProvider } from './pdl';
export { LushaProvider } from './lusha';
export { TheirStackProvider } from './theirstack';
export { LinkedinProvider } from './linkedin';
export { ApolloProvider } from './apollo';

import type { ProviderConfig } from '../types';

const keyEnvironment: Record<string, string> = {
  pdl: 'PDL_API_KEY', lusha: 'LUSHA_API_KEY',
  theirstack: 'THEIRSTACK_API_KEY', apollo: 'APOLLO_API_KEY',
};

export function providerReadiness(provider: ProviderConfig): {
  credentialConfigured: boolean; canActivate: boolean; setupMessage: string;
} {
  if (provider.name === 'linkedin') return {
    credentialConfigured: true, canActivate: true,
    setupMessage: 'Extension provider; no API key required.',
  };
  const env = keyEnvironment[provider.name];
  if (!env) return {
    credentialConfigured: false, canActivate: false,
    setupMessage: 'This provider is not supported by the current enrichment waterfall.',
  };
  const configured = (typeof provider.config?.apiKey === 'string' && provider.config.apiKey.trim().length > 0)
    || !!process.env[env]?.trim();
  return {
    credentialConfigured: configured, canActivate: configured,
    setupMessage: configured
      ? 'Credential configured locally; validity is checked on the first request, which may cost money.'
      : `Add an API key here or configure ${env} before activating.`,
  };
}

export function publicProvider(provider: ProviderConfig) {
  const { config: _secret, ...safe } = provider;
  void _secret;
  return { ...safe, ...providerReadiness(provider) };
}
