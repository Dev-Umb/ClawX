import { hostApiFetch } from '@/lib/host-api';
import type { ProviderAccount } from '@/lib/providers';

export const CLOUD_PROVIDER_ACCOUNT_ID = 'clawx-cloud-default';
export const CLOUD_PROVIDER_VENDOR_ID = 'clawx-cloud';
export const CLOUD_PROVIDER_MODEL = 'gpt-4o';
export const CLOUD_PROVIDER_NAME = 'ClawX Cloud';
export const CLOUD_PROVIDER_BASE_URL = (
  import.meta.env.VITE_CLAWX_CLOUD_BASE_URL || 'http://127.0.0.1:9090'
).replace(/\/$/, '');

function buildCloudProviderAccount(): ProviderAccount {
  const now = new Date().toISOString();
  return {
    id: CLOUD_PROVIDER_ACCOUNT_ID,
    vendorId: CLOUD_PROVIDER_VENDOR_ID,
    label: CLOUD_PROVIDER_NAME,
    authMode: 'api_key',
    baseUrl: `${CLOUD_PROVIDER_BASE_URL}/api/v1/llm`,
    apiProtocol: 'openai-completions',
    model: CLOUD_PROVIDER_MODEL,
    enabled: true,
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  };
}

export async function ensureCloudProvider(accessToken: string): Promise<void> {
  const accounts = await hostApiFetch<ProviderAccount[]>('/api/provider-accounts');
  const cloudAccount = accounts.find((account) => account.id === CLOUD_PROVIDER_ACCOUNT_ID);
  const nextAccount = buildCloudProviderAccount();

  if (!cloudAccount) {
    await hostApiFetch('/api/provider-accounts', {
      method: 'POST',
      body: JSON.stringify({
        account: nextAccount,
        apiKey: accessToken,
      }),
    });
  } else {
    await hostApiFetch(`/api/provider-accounts/${encodeURIComponent(CLOUD_PROVIDER_ACCOUNT_ID)}`, {
      method: 'PUT',
      body: JSON.stringify({
        updates: {
          label: nextAccount.label,
          baseUrl: nextAccount.baseUrl,
          model: nextAccount.model,
          enabled: true,
          authMode: 'api_key',
          apiProtocol: 'openai-completions',
        },
        apiKey: accessToken,
      }),
    });
  }

  await hostApiFetch('/api/provider-accounts/default', {
    method: 'PUT',
    body: JSON.stringify({ accountId: CLOUD_PROVIDER_ACCOUNT_ID }),
  });
}

export async function removeCloudProviders(): Promise<void> {
  const accounts = await hostApiFetch<ProviderAccount[]>('/api/provider-accounts');
  const cloudAccounts = accounts.filter((account) => account.vendorId === CLOUD_PROVIDER_VENDOR_ID);
  for (const account of cloudAccounts) {
    await hostApiFetch(`/api/provider-accounts/${encodeURIComponent(account.id)}`, {
      method: 'DELETE',
    });
  }
}
