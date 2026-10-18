import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, parseAddress } from '../src/config.js';
import { POLL_INTERVAL } from '../src/constants.js';

test('the address: IPv4 or host name, a pasted http URL reduced, HTTPS refused', () => {
  assert.deepEqual(parseAddress(' 192.168.1.60 '), { host: '192.168.1.60', port: 80 });
  assert.deepEqual(parseAddress('http://192.168.1.60:8080/info'), {
    host: '192.168.1.60',
    port: 8080,
  });
  assert.deepEqual(parseAddress('Duco_123abc'.replace('_', '-')), {
    host: 'duco-123abc',
    port: 80,
  });
  for (const bad of [
    '',
    'https://192.168.1.60',
    '300.1.1.1',
    '1.2.3',
    'a b',
    'x:0',
    'x:70000',
    '-x',
    'a_b',
    'user:pw@host',
    '[::1]',
  ]) {
    assert.equal(parseAddress(bad), undefined, bad);
  }
  assert.equal(normalizeConfig({ address: 'a_b' }).invalid, 'a_b');
  assert.equal(normalizeConfig({ address: '' }).invalid, undefined);
  assert.equal(normalizeConfig({ address: '' }).address, undefined);
});

test('the commands are allowed by true only', () => {
  assert.equal(normalizeConfig({}).allowCommands, false);
  assert.equal(normalizeConfig({ allow_commands: true }).allowCommands, true);
  assert.equal(normalizeConfig({ allow_commands: 'true' }).allowCommands, true);
  for (const value of [1, '1', 'yes', 'TRUE', {}, [], null, undefined, false, 'false']) {
    assert.equal(normalizeConfig({ allow_commands: value }).allowCommands, false, String(value));
  }
});

test('interval bounded, language fr or en, unknown keys ignored', () => {
  assert.equal(normalizeConfig({ poll_interval: 1 }).pollInterval, POLL_INTERVAL.min);
  assert.equal(normalizeConfig({ poll_interval: 99999 }).pollInterval, POLL_INTERVAL.max);
  assert.equal(normalizeConfig({ poll_interval: '' }).pollInterval, POLL_INTERVAL.default);
  assert.equal(normalizeConfig({ poll_interval: 'x' }).pollInterval, POLL_INTERVAL.default);
  assert.equal(normalizeConfig({ language: 'de' }).language, 'fr');
  assert.equal(normalizeConfig({ language: 'en' }).language, 'en');
  const polluted = normalizeConfig(JSON.parse('{"__proto__":{"allow_commands":true}}'));
  assert.equal(polluted.allowCommands, false);
  assert.equal({}.allow_commands, undefined);
});
