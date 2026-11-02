import test from 'node:test';
import assert from 'node:assert/strict';

import { apply, createProvider, createSecretResolver, normalizeConfig, PROVIDER_ID } from '../index.js';

const base = {
  controller: 'http://127.0.0.1:9090',
  secret: '',
  fakeCidrs: '198.18.0.0/15',
};

test('provider id is stable and available', () => {
  const provider = createProvider({ ...base });
  assert.equal(PROVIDER_ID, 'clash-dns');
  assert.equal(provider.id, 'clash-dns');
  assert.equal(provider.available(), true);
});

test('invalid connect mode is rejected at boot', () => {
  assert.throws(() => normalizeConfig({ ...base, connect: 'proxy' }), /connect/);
});

test('invalid resolve mode is rejected at boot', () => {
  assert.throws(() => normalizeConfig({ ...base, resolve: 'system' }), /resolve/);
});

test('empty fakeCidrs is rejected', () => {
  assert.throws(() => normalizeConfig({ ...base, fakeCidrs: '' }), /fakeCidrs/);
});

test('negative cache TTL is rejected', () => {
  assert.throws(() => normalizeConfig({ ...base, cacheTtlMs: -1 }), /cacheTtlMs/);
});

test('plain http controller must be loopback or private', () => {
  assert.throws(
    () => normalizeConfig({ ...base, controller: 'http://example.com:9090' }),
    /loopback or private/,
  );
});

test('https controller may be public', () => {
  const config = normalizeConfig({ ...base, controller: 'https://clash.example.com:9090' });
  assert.equal(config.controllerUrl.protocol, 'https:');
});

test('lanCidrs accepts comma separated CIDRs and empty string', () => {
  const config = normalizeConfig({ ...base, lanCidrs: '192.168.0.0/16, 10.0.0.0/8' });
  assert.equal(config.lanCidrs.length, 2);
  const empty = normalizeConfig({ ...base, lanCidrs: '' });
  assert.equal(empty.lanCidrs.length, 0);
});

test('private and fake IP literals are refused before any connection', async () => {
  const provider = createProvider({ ...base });

  await assert.rejects(provider.fetch({ url: 'http://127.0.0.1:1/' }), /not a public address/);
  await assert.rejects(provider.fetch({ url: 'http://198.18.0.36/' }), /Fake-IP placeholder/);
  await assert.rejects(provider.fetch({ url: 'http://10.0.0.5/' }), /not a public address/);
});

test('non-http schemes and credentials are refused', async () => {
  const provider = createProvider({ ...base });

  await assert.rejects(provider.fetch({ url: 'ftp://example.com/' }), /only http/);
  await assert.rejects(provider.fetch({ url: 'https://user:pass@example.com/' }), /credentials/);
});

test('fetch without url is invalid', async () => {
  const provider = createProvider({ ...base });
  await assert.rejects(provider.fetch({}), /invalid URL/);
});

test('volatile config refs are unwrapped', () => {
  const ref = (value) => ({ get: () => value });
  const provider = createProvider({
    controller: ref('http://192.168.0.1:9090'),
    secret: ref('secret'),
    resolve: ref('auto'),
    connect: ref('fake'),
    fakeCidrs: ref('198.18.0.0/15, fdfe:dcba:9876::/48'),
    lanCidrs: ref('192.168.0.0/16'),
    cacheTtlMs: ref(60000),
  });
  assert.equal(provider.id, 'clash-dns');

  const config = normalizeConfig({ fakeCidrs: ref('198.18.0.0/15') });
  assert.equal(config.fakeCidrs.length, 1);
});

test('apply registers the provider and survives live edits', () => {
  const registered = [];
  const handlers = {};
  const ctx = {
    on: (name, handler) => { handlers[name] = handler; },
    web: { registerFetchProvider: (provider) => registered.push(provider) },
  };
  let fakeCidrs = '198.18.0.0/15';
  apply(ctx, { fakeCidrs: { get: () => fakeCidrs } });

  assert.equal(registered.length, 1);
  assert.equal(registered[0].id, 'clash-dns');

  // A bad live edit keeps the last good runtime instead of throwing.
  fakeCidrs = '';
  handlers['loader/volatile-update']();

  // A good live edit swaps the runtime.
  fakeCidrs = '198.18.0.0/15, 198.19.0.0/16';
  handlers['loader/volatile-update']();
  assert.equal(registered[0].available(), true);
});

test('the secret environment variable wins over the literal field', () => {
  process.env.DSH_TEST_CLASH_SECRET = 'from-env';
  try {
    const config = normalizeConfig({ secretEnv: 'DSH_TEST_CLASH_SECRET', secret: 'literal' });
    assert.equal(config.secretValue, 'from-env');
  } finally {
    delete process.env.DSH_TEST_CLASH_SECRET;
  }

  assert.equal(normalizeConfig({ secretEnv: 'DSH_TEST_CLASH_SECRET', secret: 'literal' }).secretValue, 'literal');
  assert.equal(normalizeConfig({ secretEnv: '', secret: 'literal' }).secretValue, 'literal');
  assert.equal(normalizeConfig({ secretEnv: 'DSH_TEST_CLASH_SECRET' }).secretValue, '');
});

test('the credential service wins over env and literal fallbacks', async () => {
  const calls = [];
  const ctx = {
    credentials: {
      resolve: async (ref) => {
        calls.push(ref);
        return ref === 'DSH_TEST_REF' ? { value: 'from-store', source: 'file' } : undefined;
      },
    },
  };

  const stored = normalizeConfig({ secretRef: 'DSH_TEST_REF', secretEnv: '', secret: 'literal' });
  assert.equal(await createSecretResolver(ctx, stored)(), 'from-store');
  assert.deepEqual(calls, ['DSH_TEST_REF']);

  const missing = normalizeConfig({ secretRef: 'DSH_OTHER_REF', secretEnv: '', secret: 'literal' });
  assert.equal(await createSecretResolver(ctx, missing)(), 'literal');

  const noService = normalizeConfig({ secretRef: 'DSH_TEST_REF', secretEnv: '', secret: 'literal' });
  assert.equal(await createSecretResolver({}, noService)(), 'literal');

  const throwing = { credentials: { resolve: async () => { throw new Error('boom'); } } };
  assert.equal(await createSecretResolver(throwing, stored)(), 'literal');
});
