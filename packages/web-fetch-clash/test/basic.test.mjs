import test from 'node:test';
import assert from 'node:assert/strict';

import { createProvider, normalizeConfig, PROVIDER_ID } from '../index.js';

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
