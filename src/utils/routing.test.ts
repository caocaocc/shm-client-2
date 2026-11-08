import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOutbound, normalizeRules, buildEnableRequest, buildDisableRequest, draftAfterSave, readRoutingOptions, readSavedRoutingOutbound, RoutingInputError } from './routing.ts';

const b64 = (value: string) => Buffer.from(value).toString('base64');
const privateKey = Buffer.alloc(32, 1).toString('base64');
const publicKey = Buffer.alloc(32, 2).toString('base64');
const wg = `[Interface]\nPrivateKey = ${privateKey}\nAddress = 10.20.0.2/24, 2001:db8::2/128\nDNS = 1.1.1.1\nMTU = 1420\n\n[Peer]\nPublicKey = ${publicKey}\nEndpoint = [2001:db8::1]:51820\nAllowedIPs = 0.0.0.0/0, ::/0\nPersistentKeepalive = 25`;
const invalid = (value: string, code?: string) => assert.throws(() => parseOutbound(value), error => error instanceof RoutingInputError && (!code || error.code === code));

test('SOCKS URI decodes percent escapes once, preserves plus and emits only the native outbound', () => {
  const result = parseOutbound('socks5://alice%2Bqa:p%2520+word@Example.COM:1080')!;
  assert.deepEqual(result.outbound, { protocol: 'socks', settings: { servers: [{ address: 'example.com', port: 1080, users: [{ user: 'alice+qa', pass: 'p%20+word' }] }] } });
  assert.deepEqual(result.summary, { protocol: 'socks', server: 'example.com', port: 1080 });
  assert.ok(!JSON.stringify(result.summary).includes('alice'));
  assert.deepEqual(parseOutbound('socks5://[2001:0db8::1]:1080')!.summary, { protocol: 'socks', server: '2001:db8::1', port: 1080 });
  invalid('socks5://user:p@ss@proxy.example.com:1080', 'ambiguousInput');
  invalid('socks5://user:@proxy.example.com:1080');
  invalid('socks5://proxy.example.com:1080?udp=true');
  invalid('socks5://proxy.example.com:70000');
});

test('SOCKS text preserves raw four-part values and rejects conflicting labelled fields', () => {
  const four = parseOutbound('proxy.example.com:1080:demo:p+%20')!;
  assert.deepEqual(four.warnings, []);
  assert.deepEqual(four.outbound.settings.servers, [{ address: 'proxy.example.com', port: 1080, users: [{ user: 'demo', pass: 'p+%20' }] }]);
  assert.equal(parseOutbound('服务器: proxy.example.com\n端口: 1080\n用户名: demo\n密码: p+word')!.summary.protocol, 'socks');
  assert.deepEqual(parseOutbound('demo:p+%2520@proxy.example.com:1080')!.warnings, []);
  invalid('Host: a.example.com\nServer: b.example.com\nPort: 1080', 'ambiguousInput');
  invalid('Host: a.example.com\nPort: 1080\nPlugin: arbitrary', 'unsupportedField');
  assert.deepEqual(parseOutbound('a.example.com:1080:demo:password:extra')!.outbound.settings.servers,
    [{ address: 'a.example.com', port: 1080, users: [{ user: 'demo', pass: 'password:extra' }] }]);
});

test('common SOCKS userinfo and unauthenticated endpoints import explicitly without HTTP guessing', () => {
  const authenticated = parseOutbound('alice%2Bqa:p%2520+word@[2001:db8::1]:1080')!;
  assert.deepEqual(authenticated.outbound.settings.servers, [{ address: '2001:db8::1', port: 1080, users: [{ user: 'alice+qa', pass: 'p%20+word' }] }]);
  assert.deepEqual(authenticated.warnings, []);
  for (const [source, address] of [['proxy.example.com:1080', 'proxy.example.com'], ['[2001:0db8::1]:1080', '2001:db8::1']]) {
    const result = parseOutbound(source)!;
    assert.deepEqual(result.outbound.settings.servers, [{ address, port: 1080 }]);
    assert.deepEqual(result.warnings, []);
  }
  for (const value of ['user:pass@extra@proxy.example.com:1080', 'user@proxy.example.com:1080', 'user:@proxy.example.com:1080', 'proxy.example.com:1080/path', '2001:db8::1:1080', '[proxy.example.com]:1080', '[203.0.113.1]:1080']) invalid(value);
  invalid('http://proxy.example.com:1080', 'unsupportedProtocol');
});

test('SOCKS aliases and URI authorities preserve reserved credentials, normalize IDNA, and require explicit IPv6 brackets', () => {
  const result = parseOutbound('socks://用%2B户:p%3A%40%25%20+@代理.测试:1080')!;
  assert.deepEqual(result.outbound.settings.servers, [{ address: 'xn--mnq481g.xn--0zwm56d', port: 1080, users: [{ user: '用+户', pass: 'p:@% +' }] }]);
  assert.equal(parseOutbound('socks5://user:123@proxy.example.com:1080')!.summary.protocol, 'socks');
  assert.equal(parseOutbound('socks5://u:p:a:b@[2001:db8::1]:1080/')!.summary.server, '2001:db8::1');
  for (const source of ['socks5://u:p@2001:db8::1:1080', 'socks5://u:p@host:1080/path', 'socks5://u:p#fragment@host:1080', 'socks5://u:%ZZ@host:1080']) invalid(source);
});

test('common delimited SOCKS formats keep literal credentials, including colon passwords and meaningful spaces', () => {
  for (const source of ['proxy.example.com:1080:demo:p:a+%20', 'proxy.example.com|1080|demo|p:a+%20', 'proxy.example.com,1080,demo,p:a+%20', 'proxy.example.com 1080 demo p:a+%20', 'proxy.example.com\n1080\ndemo\np:a+%20', 'proxy.example.com:1080@demo:p:a+%20']) {
    assert.deepEqual(parseOutbound(source)!.outbound.settings.servers, [{ address: 'proxy.example.com', port: 1080, users: [{ user: 'demo', pass: 'p:a+%20' }] }]);
    assert.deepEqual(parseOutbound(source)!.warnings, []);
  }
  for (const source of ['proxy.example.com|1080| user | pass ', 'proxy.example.com,1080, user , pass ']) {
    assert.deepEqual(parseOutbound(source)!.outbound.settings.servers, [{ address: 'proxy.example.com', port: 1080, users: [{ user: ' user ', pass: ' pass ' }] }]);
  }
  assert.deepEqual(parseOutbound('proxy.example.com:1080:demo:http://p:a+%20')!.outbound.settings.servers,
    [{ address: 'proxy.example.com', port: 1080, users: [{ user: 'demo', pass: 'http://p:a+%20' }] }]);
  for (const source of ['[2001:db8::1]:1080:demo:p:a', '[2001:db8::1]|1080|demo|p:a', '[2001:db8::1],1080,demo,p:a', '[2001:db8::1] 1080 demo p:a', '[2001:db8::1]:1080@demo:p:a']) assert.equal(parseOutbound(source)!.summary.server, '2001:db8::1');
});

test('bare at-sign forms reject ambiguous endpoint direction and multiple nodes rather than guessing', () => {
  for (const source of ['user:123@proxy.example.com:1080', 'proxy.example.com:1080@user:123', 'a.example.com:1080@b.example.com:1081', 'a.example.com:1080:u:p\nb.example.com:1080:u:p', 'a.example.com:1080:u:p b.example.com:1080:u:p', 'a.example.com|1080|u|p|b.example.com|1080|u|p', 'a.example.com,1080,u,p,b.example.com,1080,u,p']) invalid(source, 'ambiguousInput');
});

test('labeled provider fields support explicit SOCKS protocol and a combined endpoint without trimming credentials', () => {
  const source = 'Protocol: SOCKS5\nServer: [2001:db8::1]:1080\nUsername: demo\nPassword:  p:a+%20 ';
  assert.deepEqual(parseOutbound(source)!.outbound.settings.servers, [{ address: '2001:db8::1', port: 1080, users: [{ user: 'demo', pass: ' p:a+%20 ' }] }]);
  invalid('Host: proxy.example.com:1080\nPort: 1081', 'invalidHost');
  invalid('Host: proxy.example.com\nPort: 1080\nUser: demo\nUsername: other\nPassword: p', 'ambiguousInput');
  invalid('Protocol: HTTP\nHost: proxy.example.com\nPort: 1080', 'unsupportedProtocol');
  for (const key of ['constructor', '__proto__', 'toString']) invalid('Host: proxy.example.com\nPort: 1080\n' + key + ': ignored', 'unsupportedField');
});

test('curl imports only an explicit SOCKS proxy and optional literal proxy authentication, never executing commands', () => {
  for (const source of ["curl --proxy 'socks5://demo:p%3Aa+%2520@proxy.example.com:1080'", "curl -xsocks5://proxy.example.com:1080 -U'demo:p:a+%20'", "curl --socks5 proxy.example.com:1080 --proxy-user 'demo:p:a+%20'", "curl --proxy=socks5://proxy.example.com:1080 --proxy-user=demo:p:a+%20"]) {
    assert.deepEqual(parseOutbound(source)!.outbound.settings.servers, [{ address: 'proxy.example.com', port: 1080, users: [{ user: 'demo', pass: 'p:a+%20' }] }]);
  }
  const result = parseOutbound("curl --socks5 '[2001:db8::1]:1080' -U '用 户: p+%20:$literal ' https://check.example.com/ip")!;
  assert.deepEqual(result.outbound.settings.servers, [{ address: '2001:db8::1', port: 1080, users: [{ user: '用 户', pass: ' p+%20:$literal ' }] }]);
  assert.deepEqual(result.warnings, []);
  invalid('curl -x proxy.example.com:1080', 'unsupportedProtocol');
  for (const source of ['curl -x socks5://proxy.example.com:1080 -x socks5://other.example.com:1080', 'curl -x socks5://u:p@proxy.example.com:1080 -U u:p', 'curl -x socks5://proxy.example.com:1080 -U u:p --proxy-user u:p', 'curl -x socks5://proxy.example.com:1080 https://a.example.com https://b.example.com', 'curl -x socks5://proxy.example.com:1080 https://a.example.com -U u:p', 'curl -x socks5://proxy.example.com:1080; echo secret', 'curl -x "socks5://u:$PASS@proxy.example.com:1080"', "curl -x 'socks5://proxy.example.com:1080"]) invalid(source, 'ambiguousInput');
  invalid('curl --insecure -x socks5://proxy.example.com:1080', 'unsupportedField');
});

test('remote-DNS variants import proxy identity with an explicit platform-DNS warning and no DNS fields', () => {
  const expected = parseOutbound('socks5://proxy.example.com:1080')!.outbound;
  for (const source of ['socks5h://proxy.example.com:1080', 'curl -x socks5h://proxy.example.com:1080', 'curl --socks5-hostname proxy.example.com:1080', 'Protocol: socks5h\nHost: proxy.example.com\nPort: 1080']) {
    const result = parseOutbound(source)!;
    assert.deepEqual(result.outbound, expected);
    assert.ok(result.warnings.includes('platformDNS'));
  }
  const authenticated = parseOutbound("curl --socks5-hostname '[2001:db8::1]:1080' -U 'user:p+%20' https://check.example.com")!;
  assert.deepEqual(authenticated.warnings, ['platformDNS']);
  assert.deepEqual(authenticated.outbound.settings.servers, [{ address: '2001:db8::1', port: 1080, users: [{ user: 'user', pass: 'p+%20' }] }]);
});

test('raw input limit counts original UTF-8 bytes, including surrounding whitespace', () => {
  const source = 'socks5://proxy.example.com:1080';
  assert.ok(parseOutbound(source + ' '.repeat(16384 - Buffer.byteLength(source))));
  invalid(source + ' '.repeat(16385 - Buffer.byteLength(source)), 'outboundTooLong');
  invalid('用'.repeat(5462), 'outboundTooLong');
});

test('SS supports current provider SIP002, plain URI and full Base64 share links without decoding a password twice', () => {
  const sip = parseOutbound(`ss://${b64('aes-128-gcm:p+%20')}@ss.example.com:8388#My%20server`)!;
  assert.deepEqual(sip.outbound.settings.servers, [{ address: 'ss.example.com', port: 8388, method: 'aes-128-gcm', password: 'p+%20' }]);
  const plain = parseOutbound('ss://aes-256-gcm:p%2520+word@ss.example.com:8388')!;
  assert.equal((plain.outbound.settings.servers as Array<{ password: string }>)[0].password, 'p%20+word');
  assert.equal(parseOutbound(`ss://${b64('chacha20-ietf-poly1305:pass@[2001:db8::1]:8388')}`)!.summary.server, '2001:db8::1');
  invalid(`ss://${b64('aes-128-gcm:password')}@ss.example.com:8388?plugin=v2ray-plugin`, 'unsupportedField');
  invalid(`ss://${b64('unknown:password')}@ss.example.com:8388`, 'unsupportedCipher');
  invalid(`ss://${b64('aes-128-gcm:')}@ss.example.com:8388`);
});

test('native/SS JSON normalizes to old Xray servers format and rejects unowned settings', () => {
  const expected = parseOutbound('ss://aes-128-gcm:password@ss.example.com:8388')!.outbound;
  assert.deepEqual(parseOutbound(JSON.stringify({ server: 'ss.example.com', server_port: 8388, method: 'aes-128-gcm', password: 'password' }))!.outbound, expected);
  assert.deepEqual(parseOutbound(JSON.stringify({ protocol: 'shadowsocks', settings: { address: 'ss.example.com', port: 8388, method: 'aes-128-gcm', password: 'password' } }))!.outbound, expected);
  for (const extra of [{ tag: 'owned-by-someone-else' }, { streamSettings: {} }, { mux: {} }]) invalid(JSON.stringify({ ...expected, ...extra }), 'unsupportedField');
  invalid(JSON.stringify({ protocol: 'socks', settings: { servers: [{ address: 'a.example.com', port: 1080 }, { address: 'b.example.com', port: 1080 }] } }), 'singleOutbound');
  invalid(JSON.stringify({ outbounds: [expected] }));
  invalid(JSON.stringify({ server: 'ss.example.com', server_port: 8388, method: 'aes-128-gcm', password: 'password', plugin_opts: 'hidden' }), 'unsupportedField');
});

test('SS2022 validates each PSK in its identity chain', () => {
  const key = Buffer.alloc(16, 3).toString('base64');
  assert.equal(parseOutbound(`ss://${b64('2022-blake3-aes-128-gcm:' + key + ':' + key)}@ss.example.com:8388`)!.summary.protocol, 'shadowsocks');
  invalid(`ss://${b64('2022-blake3-aes-256-gcm:' + key)}@ss.example.com:8388`, 'invalidKey');
  const key256 = Buffer.alloc(32, 4).toString('base64');
  assert.equal(parseOutbound(`ss://${b64('2022-blake3-aes-256-gcm:' + key256 + ':' + key256)}@ss.example.com:8388`)!.summary.protocol, 'shadowsocks');
  assert.equal(parseOutbound(`ss://${b64('2022-blake3-chacha20-poly1305:' + key256)}@ss.example.com:8388`)!.summary.protocol, 'shadowsocks');
  invalid(`ss://${b64('2022-blake3-chacha20-poly1305:' + key256 + ':' + key256)}@ss.example.com:8388`, 'invalidKey');
});

test('WireGuard single-peer conf maps native fields and DNS while retaining interface host bits', () => {
  const parsed = parseOutbound(wg)!;
  assert.deepEqual(parsed.outbound, { protocol: 'wireguard', settings: { secretKey: privateKey, address: ['10.20.0.2/24', '2001:db8::2/128'], peers: [{ publicKey, endpoint: '[2001:db8::1]:51820', allowedIPs: ['0.0.0.0/0', '::/0'], keepAlive: 25 }], mtu: 1420, remoteDNS: ['1.1.1.1'] } });
  assert.deepEqual(parsed.warnings, []);
  assert.deepEqual(parseOutbound(JSON.stringify(parsed.outbound))!.outbound, parsed.outbound);
  const hostPeers = parseOutbound(wg.replace('0.0.0.0/0, ::/0', '203.0.113.1, 2001:db8::1'))!.outbound.settings.peers as Array<{ allowedIPs: string[] }>;
  assert.deepEqual(hostPeers[0].allowedIPs, ['203.0.113.1/32', '2001:db8::1/128']);
  for (const field of ['PostUp = touch /tmp/unwanted', 'Jc = 4', 'ListenPort = 1234', 'UnknownField = no']) invalid(wg.replace('[Peer]', field + '\n[Peer]'), 'unsupportedField');
  invalid(wg + '\n[Peer]\nPublicKey = ' + publicKey, 'singlePeer');
  invalid(wg.replace(privateKey, 'not-a-key'), 'invalidKey');
  for (const field of ['reserved', 'noKernelTun', 'domainStrategy']) invalid(JSON.stringify({ protocol: 'wireguard', settings: { ...parsed.outbound.settings, [field]: true } }), 'unsupportedField');
});

test('WireGuard DNS accepts one to eight literal tunnel IPs, normalizes them and preserves exact input text', () => {
  const addresses = ['10.64.0.1', 'fd00::53', '1.1.1.1', '2606:4700:4700::1111', '192.168.1.1', '172.16.0.1', '10.64.0.1', '2001:0DB8:0000:0000:0000:0000:0000:0053'];
  const normalized = [...addresses.slice(0, -1), '2001:db8::53'];
  const original = ` \r\n${wg.replace('DNS = 1.1.1.1', 'DNS = ' + addresses.join(', '))}\r\n`;
  const parsed = parseOutbound(original)!;
  assert.deepEqual(parsed.outbound.settings.remoteDNS, normalized);
  assert.deepEqual(parsed.warnings, []);
  assert.deepEqual(parseOutbound(JSON.stringify({ ...parsed.outbound, settings: { ...parsed.outbound.settings, remoteDNS: addresses } }))!.outbound.settings.remoteDNS, normalized);
  const saved = buildEnableRequest(42, original, 'example.com', false);
  assert.equal(saved.secret?.outbound_text, original);
  assert.deepEqual(saved.secret?.outbound.settings.remoteDNS, normalized);
  assert.equal(readSavedRoutingOutbound({ data: [{ secret: saved.secret }] }), original);
  const omitted = parseOutbound(wg.replace('DNS = 1.1.1.1\n', ''))!;
  assert.equal('remoteDNS' in omitted.outbound.settings, false);
  assert.equal('remoteDNS' in parseOutbound(JSON.stringify(omitted.outbound))!.outbound.settings, false);
});

test('WireGuard DNS rejects invalid count, names, URLs, networks, ports, zones and non-string items', () => {
  const outbound = parseOutbound(wg)!.outbound;
  const nativeDNS = (remoteDNS: unknown) => JSON.stringify({ ...outbound, settings: { ...outbound.settings, remoteDNS } });
  for (const value of [null, '', '1.1.1.1', [], Array(9).fill('1.1.1.1'), [1], [null], [' 1.1.1.1'], ['1.1.1.1 '], ['1.1.1.1', '']]) invalid(nativeDNS(value), 'invalidDNS');
  for (const value of ['', 'dns.example.com', 'https://1.1.1.1/dns-query', '1.1.1.1/32', '1.1.1.1:53', '[fd00::53]:53', '[fd00::53]', 'fe80::1%eth0', '999.1.1.1', '01.1.1.1', '1.1.1.1,,8.8.8.8', '1.1.1.1, search.example.com', Array(9).fill('1.1.1.1').join(',')]) {
    invalid(wg.replace('DNS = 1.1.1.1', 'DNS = ' + value), 'invalidDNS');
    invalid(nativeDNS([value]), 'invalidDNS');
  }
});

test('SOCKS credentials are limited to 255 UTF-8 bytes for both username and password', () => {
  const input = (user: string, pass: string) => JSON.stringify({ protocol: 'socks', settings: { servers: [{ address: 'proxy.example.com', port: 1080, users: [{ user, pass }] }] } });
  assert.ok(parseOutbound(input('u'.repeat(255), 'p'.repeat(255))));
  assert.ok(parseOutbound(input('用'.repeat(85), '密'.repeat(85))));
  for (const [user, pass] of [['u'.repeat(256), 'pass'], ['user', 'p'.repeat(256)], ['用'.repeat(86), 'pass'], ['user', '密'.repeat(86)]]) invalid(input(user, pass), 'credentialsTooLong');
  invalid('user:' + encodeURIComponent('密'.repeat(86)) + '@proxy.example.com:1080', 'credentialsTooLong');
});

test('WireGuard accepts exactly 64 AllowedIPs and rejects 65 before submitting', () => {
  const ranges = Array.from({ length: 65 }, (_, i) => `10.${i}.0.0/16`);
  assert.ok(parseOutbound(wg.replace('0.0.0.0/0, ::/0', ranges.slice(0, 64).join(', '))));
  invalid(wg.replace('0.0.0.0/0, ::/0', ranges.join(', ')), 'tooManyAllowedIPs');
  const native = parseOutbound(wg)!.outbound;
  (native.settings.peers as Array<{ allowedIPs: string[] }>)[0].allowedIPs = ranges;
  invalid(JSON.stringify(native), 'tooManyAllowedIPs');
});

test('rules normalize IDNA, dual-stack CIDRs and duplicate entries, never interpret arbitrary match expressions', () => {
  assert.deepEqual(normalizeRules('Example.COM.\nexample.com\n中国.测试\nGEOSITE:Google\n203.0.113.10\n198.51.100.7/24\n2001:0db8:0:1::1234/64\nGEOIP:CN'), ['example.com', 'xn--fiqs8s.xn--0zwm56d', 'geosite:google', '203.0.113.10', '198.51.100.0/24', '2001:db8:0:1::/64', 'geoip:cn']);
  for (const value of ['regexp:.*', 'keyword:example', 'ext:file:tag', 'domain:example.com', 'https://example.com', '*.example.com', 'example.com\\path', '{"domain":"example.com"}', '999.1.2.3', '10.0.0.1/33', '2001:db8::/129']) assert.throws(() => normalizeRules('example.com\n' + value), error => error instanceof RoutingInputError && error.line === 2);
  assert.throws(() => normalizeRules(' \n'), error => error instanceof RoutingInputError && error.code === 'rulesRequired');
  assert.throws(() => normalizeRules(Array.from({ length: 201 }, (_, i) => `example${i}.com`).join('\n')));
});

test('save keeps existing credentials when blank, never enables an empty ruleset, and disable ignores invalid drafts', () => {
  assert.deepEqual(buildEnableRequest(42, '', 'Example.COM', true), { user_service_id: 42, enabled: true, data: { rules: ['example.com'] } });
  const existingSummary = { protocol: 'socks' as const, server: 'proxy.example.com', port: 1080 };
  assert.deepEqual(buildEnableRequest(42, '', 'Example.COM', true, existingSummary), { user_service_id: 42, enabled: true, data: { rules: ['example.com'], outbound: existingSummary } });
  assert.throws(() => buildEnableRequest(42, '', 'example.com', false), error => error instanceof RoutingInputError && error.code === 'outboundRequired');
  assert.throws(() => buildEnableRequest(42, 'socks5://example.com:1080', '', false));
  const request = buildEnableRequest(42, 'socks5://example.com:1080', 'geoip:cn', false);
  assert.deepEqual(request.data.outbound, { protocol: 'socks', server: 'example.com', port: 1080 });
  assert.deepEqual(request.secret?.outbound.settings.servers, [{ address: 'example.com', port: 1080 }]);
  const invalidDraft = { secret: 'do-not-send', rules: 'regexp:.*' };
  assert.deepEqual(buildDisableRequest(42), { user_service_id: 42, enabled: false });
  assert.ok(!JSON.stringify(buildDisableRequest(42)).includes(invalidDraft.secret));
});

test('capability is server-owned and GET/POST envelopes never introduce secret material into displayed state', () => {
  const row = { supported: true, feature: 'routing', enabled: true, has_secret: true, data: { rules: ['example.com'], outbound: { protocol: 'socks', server: 'proxy.example.com', port: 1080 }, password: 'must-not-copy' }, secret: { password: 'must-not-copy' }, status: 'submitted' };
  const envelope = { status: 200, data: [row] };
  const state = readRoutingOptions(envelope);
  assert.equal(envelope.status, 200, 'the SHM response status remains numeric');
  assert.equal(state.supported, true); assert.equal(state.has_secret, true); assert.equal(state.status, 'submitted');
  assert.equal(state.feature, 'routing');
  assert.deepEqual(state.data.outbound, { protocol: 'socks', server: 'proxy.example.com', port: 1080 });
  assert.equal('kind' in state, false);
  assert.ok(!JSON.stringify(state).includes('must-not-copy'));
  assert.equal(readRoutingOptions({ data: [{ ...row, supported: false }] }).supported, false);
  assert.equal(readRoutingOptions({ data: [{ ...row, feature: 'something_else' }] }).supported, false);
  assert.equal(readRoutingOptions({ data: [{ ...row, data: { rules: [], outbound: { protocol: 'socks', server: 'user:private-password@proxy.example.com', port: 1080 } } }] }).data.outbound, undefined);
  const secret = 'private-password-never-in-errors';
  try { parseOutbound(`socks5://user:${secret}@host:invalid`); } catch (error) { assert.ok(!(error as Error).message.includes(secret)); }
});

test('successful save retains outbound input and canonical rules; disabling does not submit or erase drafts', () => {
  const saved = readRoutingOptions({ data: [{ supported: true, feature: 'routing', enabled: true, has_secret: true, data: { rules: ['example.com', 'geoip:cn'] }, status: 'queued' }] });
  const draft = { outbound: 'socks5://user:private-password@proxy.example.com:1080', rules: 'Example.COM\nGEOIP:CN' };
  assert.deepEqual(draftAfterSave(draft, saved, false), { outbound: draft.outbound, rules: 'example.com\ngeoip:cn' });
  assert.deepEqual(draftAfterSave(draft, saved, true), draft);
  assert.deepEqual(draftAfterSave({ outbound: 'invalid draft', rules: 'regexp:.*' }, saved, true), { outbound: 'invalid draft', rules: 'regexp:.*' });
  assert.deepEqual(draftAfterSave({ outbound: '', rules: draft.rules }, saved, false), { outbound: '', rules: 'example.com\ngeoip:cn' });
});

test('a retained saved outbound never replaces current credentials during rule edits or re-enabling', () => {
  const outbound = 'socks5://user:private-password@proxy.example.com:1080';
  const summary = { protocol: 'socks' as const, server: 'proxy.example.com', port: 1080 };
  const request = buildEnableRequest(42, outbound, 'other.example.com', true, summary, outbound);
  assert.deepEqual(request, { user_service_id: 42, enabled: true, data: { rules: ['other.example.com'], outbound: summary } });
  assert.equal(buildEnableRequest(42, ` \n${outbound}\n`, 'example.com', true, summary, outbound).secret?.outbound_text, ` \n${outbound}\n`);
  assert.ok('secret' in buildEnableRequest(42, outbound.replace('private-password', 'changed-password'), 'example.com', true, summary, outbound));
  assert.ok('secret' in buildEnableRequest(42, outbound, 'example.com', false, summary, outbound));
});

test('saved outbound recovery requires exact source text and never reconstructs absent source', () => {
  const original = 'socks5://name:secret@proxy.example.com:1080';
  const outbound = parseOutbound(original)!.outbound;
  assert.equal(readSavedRoutingOutbound({ data: [{ secret: { outbound, outbound_text: original } }] }), original);
  for (const response of [{ data: [] }, { data: [{ secret: {} }] }, { data: [{ secret: { outbound } }] },
    { data: [{ secret: { outbound: { protocol: 'http', settings: { password: 'do-not-leak' } } } }] },
    { data: [{ secret: { outbound: 'socks5://secret' } }] }, { data: [{}] }]) {
    assert.throws(() => readSavedRoutingOutbound(response), error => error instanceof RoutingInputError && !error.message.includes('do-not-leak'));
  }
});

test('unconfigured and cleaned options accept empty data while capability detection stays server-owned', () => {
  assert.equal(readRoutingOptions({ data: [{ supported: false }] }).supported, false);
  for (const status of ['disabled', 'cleaned']) {
    assert.deepEqual(readRoutingOptions({ data: [{ supported: true, feature: 'routing', enabled: false, has_secret: false, data: {}, status }] }), {
      supported: true, feature: 'routing', enabled: false, has_secret: false, data: { rules: [] }, status,
    });
  }
});

test('routing accepts only its six current states without interpreting other service features', () => {
  const row = { supported: true, feature: 'routing', enabled: true, has_secret: true, data: {} };
  for (const status of ['disabled', 'queued', 'submitted', 'waiting_service', 'error', 'cleaned']) {
    assert.equal(readRoutingOptions({ data: [{ ...row, status }] }).status, status);
  }
  assert.equal(readRoutingOptions({ data: [{ supported: false }] }).supported, false);
  assert.equal(readRoutingOptions({ data: [{ ...row, feature: 'another_feature', status: 'another_state' }] }).supported, false);
});

test('only the current SHM response contract is accepted and malformed payloads fail without exposing data', () => {
  const row = { supported: true, feature: 'routing', enabled: true, has_secret: true, data: { rules: ['example.com'] }, status: 'queued' };
  for (const response of [row, { data: row }, { data: [] }, { data: [row, row] },
    { data: [{ ...row, kind: 'proxy_routing' }] },
    { data: [{ ...row, feature: undefined }] },
    { data: [{ ...row, enabled: 1 }] }, { data: [{ ...row, has_secret: 1 }] },
    ...['', 'idle', 'unknown', 'pending', 'arbitrary-secret-text'].map(status => ({ data: [{ ...row, status }] })),
    { data: [{ ...row, status: { state: 'error', error: 'do-not-leak' } }] },
    { data: [{ supported: false, status: { state: 'disabled' } }] },
    { data: [{ ...row, data: { rules: ['example.com', 1] } }] },
    { data: [{ ...row, data: { outbound_summary: { protocol: 'socks', server: 'do-not-leak', port: 1080 } } }] },
    { data: [{ ...row, error: { token: 'do-not-leak' } }] }]) {
    assert.throws(() => readRoutingOptions(response), error => error instanceof Error && !error.message.includes('do-not-leak'));
  }
});

test('top-level failures preserve only fixed current error codes and never copy arbitrary remote text', () => {
  const row = { supported: true, feature: 'routing', enabled: true, has_secret: true, data: {}, status: 'error' };
  for (const error of ['SERVICE_OPTIONS_CONFIG_INVALID', 'SERVICE_OPTIONS_TARGET_INVALID', 'SERVICE_OPTIONS_TARGET_CHANGED']) {
    assert.equal(readRoutingOptions({ data: [{ ...row, error }] }).error, error);
  }
  for (const error of ['SERVICE_OPTIONS_POLICY_CHANGED', 'do-not-leak']) {
    const state = readRoutingOptions({ data: [{ ...row, error }] });
    assert.equal(state.error, 'SERVICE_OPTIONS_SYNC_FAILED');
    assert.ok(!JSON.stringify(state).includes(error));
  }
});
