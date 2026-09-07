import React from 'react';
import type {
  SourceControlAPI,
  SourceControlAuthStatus,
  SourceControlIdentity,
  SourceControlProviderBinding,
} from '@/lib/api/types';
import { resolveSourceControlTarget } from '@/lib/source-control/identity';
import { getRuntimeKey } from '@/lib/runtime-switch';
import { repositoryBindingOwner, useRepositoryBinding } from '@/lib/source-control/repository-binding';

const optionKey = (identity: SourceControlIdentity, accountId: string, remote: string): string =>
  JSON.stringify([identity.provider, identity.instance, accountId, remote]);

type ProviderBindingEditorInput = {
  directory: string;
  sourceControl: Pick<SourceControlAPI, 'repositoryBinding' | 'repositoryProviderBindingMutate'>;
  identities: SourceControlIdentity[];
  authEntry: (identity: SourceControlIdentity) => { hasChecked: boolean; status: SourceControlAuthStatus | null } | undefined;
  operationFailed: string;
};

export const useProviderBindingEditor = ({
  directory, sourceControl, identities, authEntry, operationFailed,
}: ProviderBindingEditorInput) => {
  const binding = useRepositoryBinding(directory, sourceControl);
  const bindingRead = binding.read;
  const [selectedKey, setSelectedKey] = React.useState('');
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const selectRef = React.useRef<HTMLButtonElement | null>(null);
  const requestIdRef = React.useRef(0);

  React.useLayoutEffect(() => {
    requestIdRef.current += 1;
    setIsSaving(false);
    setSelectedKey('');
    setError(null);
    return () => { requestIdRef.current += 1; };
  }, [binding.scope, sourceControl]);

  const options = [];
  for (const remote of bindingRead?.repository.remotes ?? []) {
    const target = resolveSourceControlTarget([{
      name: remote.name, fetchUrl: remote.fetch.displayUrl, pushUrl: remote.push.displayUrl,
    }], identities);
    if (!target) continue;
    const entry = authEntry(target.identity);
    if (!entry?.hasChecked || entry.status?.status !== 'connected') continue;
    for (const account of entry.status.accounts) {
      if (account.status !== 'valid') continue;
      options.push({ key: optionKey(target.identity, account.id, remote.name), identity: target.identity, account, remote });
    }
  }

  const boundProvider = bindingRead?.binding?.providers[0];
  const boundKey = boundProvider ? optionKey(boundProvider, boundProvider.accountId, boundProvider.primaryRemote) : '';
  const effectiveSelectedKey = selectedKey || boundKey || (!boundProvider ? options[0]?.key ?? '' : '');
  const selected = options.find((option) => option.key === effectiveSelectedKey) ?? null;

  const mutate = async (provider: SourceControlProviderBinding | null) => {
    if (!directory || !bindingRead || !binding.isCurrent() || isSaving || (!provider && !boundProvider)) return;
    const requestId = requestIdRef.current;
    const runtimeKey = getRuntimeKey();
    const isCurrentRequest = () => requestIdRef.current === requestId && runtimeKey === getRuntimeKey();
    const context = { directory, expectedRepositoryId: bindingRead.repository.repositoryId, expectedRevision: bindingRead.revision };
    const mutationScope = repositoryBindingOwner.captureMutation(binding.scope, bindingRead);
    const target = boundProvider ? {
      provider: boundProvider.provider, instance: boundProvider.instance,
      accountId: boundProvider.accountId, primaryRemote: boundProvider.primaryRemote,
    } : null;
    setIsSaving(true);
    setError(null);
    try {
      const input = provider
        ? target ? { ...context, operation: 'replace' as const, target, provider } : { ...context, operation: 'add' as const, provider }
        : target ? { ...context, operation: 'remove' as const, target } : null;
      if (!input) return;
      const nextBinding = await sourceControl.repositoryProviderBindingMutate(input);
      if (!repositoryBindingOwner.setMutationResult(mutationScope, nextBinding)) {
        await repositoryBindingOwner.reconcile(mutationScope, sourceControl);
      }
      if (!isCurrentRequest()) return;
      setSelectedKey('');
    } catch (mutationError) {
      if (isCurrentRequest()) setError(mutationError instanceof Error ? mutationError.message : operationFailed);
      await repositoryBindingOwner.reconcile(mutationScope, sourceControl);
      if (!isCurrentRequest()) return;
      selectRef.current?.focus();
    } finally {
      mutationScope.release();
      if (isCurrentRequest()) setIsSaving(false);
    }
  };

  const saveBinding = async () => {
    if (!selected) {
      selectRef.current?.focus();
      return;
    }
    await mutate({ ...selected.identity, accountId: selected.account.id, primaryRemote: selected.remote.name });
  };

  return {
    bindingRead, boundProvider, options, selected, effectiveSelectedKey, setSelectedKey,
    isLoading: binding.status === 'loading', isSaving,
    error: error ?? (binding.error ? operationFailed : null), stale: binding.stale,
    canSave: binding.status === 'ready', retry: async () => {
      setError(null);
      await binding.retry();
    },
    selectRef, saveBinding, removeBinding: () => mutate(null),
  };
};
