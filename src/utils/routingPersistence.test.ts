import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEnableRequest, readSavedRoutingOutbound, parseOutbound, RoutingInputError } from './routing.ts';

const key = btoa('k'.repeat(32));
const wg = `# Original provider comment 😀\r\n[Interface]\r\nPrivateKey = ${key}\r\nAddress = 10.0.0.2/32\r\nDNS = 1.1.1.1\r\n\r\n[Peer]\r\nPublicKey = ${key}\r\nEndpoint = wg.example.com:51820\r\nAllowedIPs = 0.0.0.0/0\r\n`;

test('new saves put exact original text only in the encrypted secret and reopen without JSON conversion', () => {
  for (const original of ['  socks5://name:pass%3Aword@proxy.example.com:1080  ',
    'proxy.example.com:1080:name:pass:with:colons', 'socks5h://name:secret@proxy.example.com:1080',
    "curl --socks5-hostname proxy.example.com:1080 -U 'name:secret' https://example.com", 'ss://aes-128-gcm:secret@ss.example.com:8388#provider-name', wg]) {
    const request = buildEnableRequest(42, original, 'example.com', false);
    assert.equal(request.secret?.outbound_text, original);
    assert.ok(!JSON.stringify(request.data).includes(original));
    assert.equal(readSavedRoutingOutbound({ data: [{ secret: request.secret }] }), original);
    assert.deepEqual(parseOutbound(readSavedRoutingOutbound({ secret: request.secret }))!.outbound, request.secret!.outbound);
  }
});

test('format-only changes are saved exactly while rule-only saves preserve existing ciphertext', () => {
  const original = 'socks5://name:secret@proxy.example.com:1080';
  assert.ok(!('secret' in buildEnableRequest(42, original, 'other.example.com', true, undefined, original)));
  const formatted = `  ${original}\n`;
  assert.equal(buildEnableRequest(42, formatted, 'example.com', true, undefined, original).secret?.outbound_text, formatted);
  assert.ok(!('secret' in buildEnableRequest(42, '', 'other.example.com', true, undefined, original)));
});

test('saved credentials missing original text are rejected instead of converted', () => {
  for (const original of ['socks5://name:secret@proxy.example.com:1080', 'ss://aes-128-gcm:secret@ss.example.com:8388', wg]) {
    const outbound = parseOutbound(original)!.outbound;
    assert.throws(() => readSavedRoutingOutbound({ secret: { outbound } }), RoutingInputError);
  }
});

test('WireGuard source DNS cannot silently augment a saved outbound without remoteDNS', () => {
  const parsed = parseOutbound(wg)!;
  const previousOutbound = structuredClone(parsed.outbound);
  delete previousOutbound.settings.remoteDNS;
  const previousSecret = { outbound: previousOutbound, outbound_text: wg };
  const original = structuredClone(previousSecret);
  assert.deepEqual(parseOutbound(JSON.stringify(previousOutbound))!.outbound, previousOutbound);
  assert.throws(() => readSavedRoutingOutbound({ data: [{ secret: previousSecret }] }), RoutingInputError);
  assert.deepEqual(previousSecret, original, 'a rejected read does not rewrite the stored structure or source');
  const submitted = buildEnableRequest(42, wg, 'example.com', true, parsed.summary, '');
  assert.deepEqual(submitted.secret?.outbound.settings.remoteDNS, ['1.1.1.1']);
  assert.equal(submitted.secret?.outbound_text, wg);
  assert.equal(readSavedRoutingOutbound({ data: [{ secret: submitted.secret }] }), wg);
  assert.deepEqual(previousSecret, original, 'explicit resubmission creates new data without mutating the previous secret');
});

test('raw text must describe the same bounded supported outbound as the stored canonical configuration', () => {
  const outbound = parseOutbound('socks5://one.example.com:1080')!.outbound;
  for (const source of ['', null, {}, 'socks5://two.example.com:1080', 'socks4://one.example.com:1080']) {
    assert.throws(() => readSavedRoutingOutbound({ secret: { outbound, outbound_text: source } }), RoutingInputError);
  }
  const plain = wg.replace(/\r\n/g, '\n');
  const prefix = '# ' + 'a'.repeat(16384 - new TextEncoder().encode(plain).length - 3) + '\n';
  const full = prefix + plain;
  assert.equal(new TextEncoder().encode(full).length, 16384);
  const saved = buildEnableRequest(42, full, 'example.com', false);
  assert.equal(readSavedRoutingOutbound({ secret: saved.secret }), full);
  assert.throws(() => buildEnableRequest(42, full + ' ', 'example.com', false), error => error instanceof RoutingInputError && error.code === 'outboundTooLong');
  assert.throws(() => parseOutbound('# ' + '😀'.repeat(4096) + '\n' + plain), error => error instanceof RoutingInputError && error.code === 'outboundTooLong');
});
