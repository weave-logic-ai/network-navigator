'use client';

import { useState, type FormEvent } from 'react';

export default function OperatorUnlockPage() {
  const [secret, setSecret] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError('');
    try {
      const response = await fetch('/api/operator/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret }),
      });
      setSecret('');
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? 'Unlock failed');
        return;
      }
      window.location.assign('/');
    } catch {
      setSecret('');
      setError('Could not reach the local app');
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-6">
      <h1 className="text-2xl font-semibold">Unlock local dashboard</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Enter the operator secret configured on this machine.
      </p>
      <form onSubmit={unlock} className="mt-6 space-y-4">
        <label htmlFor="operator-secret" className="block text-sm font-medium">Operator secret</label>
        <input
          id="operator-secret"
          type="password"
          autoComplete="off"
          required
          value={secret}
          onChange={event => setSecret(event.target.value)}
          className="w-full rounded border bg-background p-2"
        />
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <button type="submit" disabled={pending} className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50">
          {pending ? 'Unlocking…' : 'Unlock'}
        </button>
      </form>
    </main>
  );
}
