import { routingSyncErrorCode } from './routingUi.ts';

type ObjectValue = Record<string, unknown>;
const ROUTING_STATES = new Set(['disabled', 'queued', 'submitted', 'waiting_service', 'error', 'cleaned']);
export type RoutingProtocol = 'shadowsocks' | 'socks' | 'wireguard';
export interface OutboundSummary { protocol: RoutingProtocol; server: string; port: number }
export interface RoutingOutbound { protocol: RoutingProtocol; settings: ObjectValue }
export interface ParsedOutbound { outbound: RoutingOutbound; summary: OutboundSummary; warnings: string[] }
export interface RoutingOptions {
  supported: boolean;
  feature: string;
  enabled: boolean;
  has_secret: boolean;
  data: { rules: string[]; outbound?: OutboundSummary };
  status: string;
  error?: string;
}
export class RoutingInputError extends Error {
  code: string;
  line?: number;
  constructor(code: string, line?: number) { super(code); this.name = 'RoutingInputError'; this.code = code; this.line = line; }
}
const fail = (code = 'invalidOutbound'): never => { throw new RoutingInputError(code); };
const record = (value: unknown): ObjectValue => value && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : fail();
function keys(value: ObjectValue, allowed: string[]) { if (Object.keys(value).some(key => !allowed.includes(key))) fail('unsupportedField'); }
function text(value: unknown): string { return typeof value === 'string' && value.length > 0 ? value : fail(); }
function integer(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value))) fail();
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= minimum && number <= maximum ? number : fail();
}
function decodeOnce(value: string): string { try { return decodeURIComponent(value); } catch { return fail(); } }
function base64(value: string): string {
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(value) || value.length % 4 === 1) return fail();
  try {
    const raw = value.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
    const bytes = Uint8Array.from(atob(raw + '='.repeat((4 - raw.length % 4) % 4)), char => char.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch { return fail(); }
}
function ip(value: string): { version: number; address: string; number: bigint; bits: number } | null {
  if (/^\d+(?:\.\d+){3}$/.test(value)) {
    const parts = value.split('.');
    if (!parts.every(part => /^(0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255)) return null;
    return { version: 4, address: parts.join('.'), number: parts.reduce((total, part) => (total << 8n) + BigInt(part), 0n), bits: 32 };
  }
  if (!value.includes(':') || !/^[a-f\d:.]+$/i.test(value)) return null;
  try {
    const address = new URL(`http://[${value}]/`).hostname.slice(1, -1);
    const [left, right] = address.split('::');
    const first = left ? left.split(':') : [], last = right ? right.split(':') : [];
    const parts = right !== undefined ? [...first, ...Array(8 - first.length - last.length).fill('0'), ...last] : first;
    if (parts.length !== 8) return null;
    return { version: 6, address, number: parts.reduce((total, part) => (total << 16n) + BigInt('0x' + part), 0n), bits: 128 };
  } catch { return null; }
}
function domain(value: string, singleLabel = false): string {
  if (!value || /[\s\\/:@#?*%\[\]]/.test(value)) return fail('invalidHost');
  try {
    const result = new URL('http://' + value.replace(/\.$/, '') + '/').hostname.toLowerCase();
    const labels = result.split('.');
    if ((!singleLabel && labels.length < 2) || result.length > 253 || !/[a-z]/i.test(labels[labels.length - 1]) || !labels.every(label => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label))) return fail('invalidHost');
    return result;
  } catch { return fail('invalidHost'); }
}
function host(value: unknown): string {
  const raw = text(value).trim().replace(/^\[([^\]]+)\]$/, '$1');
  const address = ip(raw);
  if (address) return address.address;
  if (/^\d+(?:\.\d+){3}$/.test(raw)) return fail('invalidHost');
  return domain(raw, true);
}
function endpoint(value: unknown): { server: string; port: number; endpoint: string } {
  const raw = text(value).trim();
  const match = raw.match(/^\[([^\]]+)\]:(\d+)$/) || raw.match(/^([^:\s/]+):(\d+)$/);
  if (!match) return fail('invalidHost');
  if (raw.startsWith('[') && ip(match[1])?.version !== 6) return fail('invalidHost');
  const server = host(match[1]), port = integer(match[2], 1, 65535);
  return { server, port, endpoint: `${server.includes(':') ? '[' + server + ']' : server}:${port}` };
}
function cidr(value: string): string {
  const match = value.match(/^(.+)\/(0|[1-9]\d{0,2})$/), address = match && ip(match[1]);
  if (!match || !address || Number(match[2]) > address.bits) return fail('invalidRule');
  const prefix = Number(match[2]), shift = BigInt(address.bits - prefix), network = (address.number >> shift) << shift;
  let normalized: string;
  if (address.version === 4) normalized = [24n, 16n, 8n, 0n].map(bits => Number((network >> bits) & 255n)).join('.');
  else normalized = ip(Array.from({ length: 8 }, (_, index) => ((network >> BigInt((7 - index) * 16)) & 65535n).toString(16)).join(':'))!.address;
  return `${normalized}/${prefix}`;
}
function network(value: string): string {
  if (value.includes('/')) return cidr(value);
  const address = ip(value);
  return address ? `${address.address}/${address.bits}` : fail('invalidRule');
}
function wireguardKey(value: unknown): string {
  const key = text(value);
  if (!/^[A-Za-z0-9+/]{43}=$/.test(key)) return fail('invalidKey');
  try { if (atob(key).length !== 32 || btoa(atob(key)) !== key) return fail('invalidKey'); } catch { return fail('invalidKey'); }
  return key;
}
function ss(server: unknown, port: unknown, method: unknown, password: unknown): ParsedOutbound {
  const address = host(server), number = integer(port, 1, 65535), cipher = text(method), pass = text(password);
  const ciphers = ['aes-128-gcm', 'aes-256-gcm', 'chacha20-ietf-poly1305', 'xchacha20-ietf-poly1305', '2022-blake3-aes-128-gcm', '2022-blake3-aes-256-gcm', '2022-blake3-chacha20-poly1305'];
  if (!ciphers.includes(cipher)) return fail('unsupportedCipher');
  if (cipher.startsWith('2022-')) {
    if (cipher === '2022-blake3-chacha20-poly1305' && pass.includes(':')) return fail('invalidKey');
    const size = cipher === '2022-blake3-aes-128-gcm' ? 16 : 32;
    for (const key of pass.split(':')) {
      try { if (!/^[A-Za-z\d+/]+={0,2}$/.test(key) || atob(key).length !== size || btoa(atob(key)) !== key) return fail('invalidKey'); }
      catch { return fail('invalidKey'); }
    }
  }
  return { outbound: { protocol: 'shadowsocks', settings: { servers: [{ address, port: number, method: cipher, password: pass }] } }, summary: { protocol: 'shadowsocks', server: address, port: number }, warnings: [] };
}
function socks(server: unknown, port: unknown, user?: unknown, password?: unknown): ParsedOutbound {
  const address = host(server), number = integer(port, 1, 65535);
  const credential = (value: unknown) => {
    const parsed = text(value);
    if (new TextEncoder().encode(parsed).length > 255) return fail('credentialsTooLong');
    return parsed;
  };
  const users = user !== undefined || password !== undefined ? [{ user: credential(user), pass: credential(password) }] : undefined;
  return { outbound: { protocol: 'socks', settings: { servers: [{ address, port: number, ...(users ? { users } : {}) }] } }, summary: { protocol: 'socks', server: address, port: number }, warnings: [] };
}
function wireguardDNS(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) return fail('invalidDNS');
  return value.map(item => {
    const parsed = typeof item === 'string' ? ip(item) : null;
    return parsed ? parsed.address : fail('invalidDNS');
  });
}
function wireguard(settings: ObjectValue): ParsedOutbound {
  keys(settings, ['secretKey', 'address', 'peers', 'mtu', 'remoteDNS']);
  const secretKey = wireguardKey(settings.secretKey);
  if (!Array.isArray(settings.address) || settings.address.length < 1 || settings.address.length > 8 || !settings.address.every(item => typeof item === 'string')) return fail();
  // Interface addresses retain their host bits; AllowedIPs describe networks.
  const address = settings.address.map(item => {
    const match = item.match(/^(.+)\/(0|[1-9]\d{0,2})$/), parsed = match && ip(match[1]);
    return match && parsed && Number(match[2]) <= parsed.bits ? `${parsed.address}/${Number(match[2])}` : fail();
  });
  if (!Array.isArray(settings.peers) || settings.peers.length !== 1) return fail('singlePeer');
  const peer = record(settings.peers[0]);
  keys(peer, ['publicKey', 'preSharedKey', 'endpoint', 'allowedIPs', 'keepAlive']);
  const parsedEndpoint = endpoint(peer.endpoint);
  if (!Array.isArray(peer.allowedIPs) || !peer.allowedIPs.length || !peer.allowedIPs.every(item => typeof item === 'string')) return fail();
  if (peer.allowedIPs.length > 64) return fail('tooManyAllowedIPs');
  const normalizedPeer = {
    publicKey: wireguardKey(peer.publicKey), endpoint: parsedEndpoint.endpoint,
    allowedIPs: peer.allowedIPs.map(item => network(item)),
    ...(peer.preSharedKey !== undefined ? { preSharedKey: wireguardKey(peer.preSharedKey) } : {}),
    ...(peer.keepAlive !== undefined ? { keepAlive: integer(peer.keepAlive, 0, 65535) } : {}),
  };
  return {
    outbound: { protocol: 'wireguard', settings: { secretKey, address, peers: [normalizedPeer], ...(settings.mtu !== undefined ? { mtu: integer(settings.mtu, 576, 9000) } : {}), ...(settings.remoteDNS !== undefined ? { remoteDNS: wireguardDNS(settings.remoteDNS) } : {}) } },
    summary: { protocol: 'wireguard', server: parsedEndpoint.server, port: parsedEndpoint.port }, warnings: [],
  };
}
function native(value: unknown): ParsedOutbound {
  const object = record(value);
  if ('server' in object || 'server_port' in object) {
    keys(object, ['server', 'server_port', 'method', 'password']);
    return ss(object.server, object.server_port, object.method, object.password);
  }
  keys(object, ['protocol', 'settings']);
  const settings = record(object.settings);
  if (object.protocol === 'wireguard') return wireguard(settings);
  if (object.protocol !== 'shadowsocks' && object.protocol !== 'socks') return fail('unsupportedProtocol');
  if (settings.servers !== undefined) {
    keys(settings, ['servers']);
    if (!Array.isArray(settings.servers) || settings.servers.length !== 1) return fail('singleOutbound');
  }
  const server = settings.servers !== undefined ? record((settings.servers as unknown[])[0]) : settings;
  if (object.protocol === 'shadowsocks') {
    keys(server, ['address', 'port', 'method', 'password']);
    return ss(server.address, server.port, server.method, server.password);
  }
  keys(server, ['address', 'port', 'users']);
  if (server.users === undefined) return socks(server.address, server.port);
  if (!Array.isArray(server.users) || server.users.length !== 1) return fail();
  const user = record(server.users[0]); keys(user, ['user', 'pass']);
  return socks(server.address, server.port, user.user, user.pass);
}
function conf(raw: string): ParsedOutbound {
  const sections: Record<string, ObjectValue> = { Interface: {}, Peer: {} };
  let section = '', interfaces = 0, peers = 0;
  for (const source of raw.split(/\r?\n/)) {
    const line = source.trim().replace(/\s+#.*$/, '');
    if (!line || /^[#;]/.test(line)) continue;
    if (line === '[Interface]') { if (++interfaces !== 1 || peers) return fail('singlePeer'); section = 'Interface'; continue; }
    if (line === '[Peer]') { if (++peers !== 1 || !interfaces) return fail('singlePeer'); section = 'Peer'; continue; }
    const pair = line.match(/^([A-Za-z][A-Za-z\d]*)\s*=\s*(.*?)\s*$/);
    if (!pair || !section) return fail('unsupportedField');
    if (Object.prototype.hasOwnProperty.call(sections[section], pair[1])) return fail('ambiguousInput');
    sections[section][pair[1]] = pair[2];
  }
  if (interfaces !== 1 || peers !== 1) return fail('singlePeer');
  const first = sections.Interface, peer = sections.Peer;
  keys(first, ['PrivateKey', 'Address', 'DNS', 'MTU']);
  keys(peer, ['PublicKey', 'PresharedKey', 'Endpoint', 'AllowedIPs', 'PersistentKeepalive']);
  const split = (value: unknown) => text(value).split(',').map(item => item.trim());
  return wireguard({ secretKey: first.PrivateKey, address: split(first.Address), peers: [{ publicKey: peer.PublicKey, endpoint: peer.Endpoint, allowedIPs: split(peer.AllowedIPs), ...(peer.PresharedKey !== undefined ? { preSharedKey: peer.PresharedKey } : {}), ...(peer.PersistentKeepalive !== undefined ? { keepAlive: peer.PersistentKeepalive } : {}) }], ...(first.MTU !== undefined ? { mtu: first.MTU } : {}), ...(first.DNS !== undefined ? { remoteDNS: typeof first.DNS === 'string' ? first.DNS.split(',').map(item => item.trim()) : fail('invalidDNS') } : {}) });
}
function socksURI(value: string): ParsedOutbound {
  const remoteDNS = /^socks5h:\/\//i.test(value);
  const match = value.match(/^socks(?:5h?)?:\/\/([^\s/?#]+)\/?$/i);
  if (!match) return fail('ambiguousInput');
  const parts = match[1].split('@');
  if (parts.length > 2) return fail('ambiguousInput');
  const server = endpoint(parts[parts.length - 1]);
  let result: ParsedOutbound;
  if (parts.length === 1) result = socks(server.server, server.port);
  else {
    const colon = parts[0].indexOf(':');
    if (colon < 1) return fail('ambiguousInput');
    result = socks(server.server, server.port, decodeOnce(parts[0].slice(0, colon)), decodeOnce(parts[0].slice(colon + 1)));
  }
  if (remoteDNS) result.warnings.push('platformDNS');
  return result;
}

// This is a small literal argument reader, never a shell or command runner.
// Only the proxy options below are meaningful; no option is executed.
function curlArguments(value: string): string[] {
  const args: string[] = [];
  let token = '', quote = '', started = false;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (quote) {
      if (char === quote) quote = '';
      else if (quote === '"' && /[$`]/.test(char)) return fail('ambiguousInput');
      else if (char === '\\' && quote === '"') {
        if (value[i + 1] !== '"' && value[i + 1] !== '\\') return fail('ambiguousInput');
        token += value[++i];
      } else token += char;
    } else if (/\s/.test(char)) {
      if (started) { args.push(token); token = ''; started = false; }
    } else if (char === '"' || char === "'") { quote = char; started = true; }
    else if (char === '\\') {
      if (value[i + 1] === '\n') { i++; continue; }
      if (!value[i + 1] || !/[\s\\'"]/.test(value[i + 1])) return fail('ambiguousInput');
      token += value[++i]; started = true;
    } else {
      if (/[;&|<>$`]/.test(char)) return fail('ambiguousInput');
      token += char; started = true;
    }
  }
  if (quote) return fail('ambiguousInput');
  if (started) args.push(token);
  return args;
}
function curlProxy(value: string): ParsedOutbound {
  const args = curlArguments(value);
  let proxy: string | undefined, credentials: string | undefined, option = '', target = false;
  for (let i = 1; i < args.length; i++) {
    if (target) return fail('ambiguousInput');
    let name = args[i], argument: string | undefined;
    const equal = name.match(/^(--[^=]+)=(.*)$/), short = name.match(/^(-[xU])(.+)$/);
    if (equal || short) { name = (equal || short)![1]; argument = (equal || short)![2]; }
    if (['--proxy', '-x', '--socks5', '--socks5-hostname', '--proxy-user', '-U'].includes(name)) {
      argument ??= args[++i];
      if (!argument) return fail('ambiguousInput');
      if (name === '--proxy-user' || name === '-U') {
        if (credentials !== undefined) return fail('ambiguousInput');
        credentials = argument;
      } else {
        if (proxy !== undefined) return fail('ambiguousInput');
        proxy = argument; option = name;
      }
    } else {
      if (name.startsWith('-')) return fail('unsupportedField');
      if (target || !/^https?:\/\//i.test(name)) return fail('ambiguousInput');
      let url: URL; try { url = new URL(name); } catch { return fail('ambiguousInput'); }
      if (!url.hostname || url.username || url.password) return fail('ambiguousInput');
      target = true;
    }
  }
  if (!proxy) return fail('ambiguousInput');
  if ((option === '--socks5' || option === '--socks5-hostname') && !proxy.includes('://')) proxy = (option === '--socks5-hostname' ? 'socks5h://' : 'socks5://') + proxy;
  if (!/^socks(?:5h?)?:\/\//i.test(proxy)) return fail('unsupportedProtocol');
  const result = socksURI(proxy);
  if (option === '--socks5-hostname' && !result.warnings.includes('platformDNS')) result.warnings.push('platformDNS');
  if (credentials !== undefined) {
    const server = (result.outbound.settings.servers as ObjectValue[])[0];
    if (server.users !== undefined) return fail('ambiguousInput');
    const colon = credentials.indexOf(':');
    if (colon < 1) return fail('ambiguousInput');
    return { ...socks(server.address, server.port, credentials.slice(0, colon), credentials.slice(colon + 1)), warnings: result.warnings };
  }
  return result;
}

function socksText(value: string): ParsedOutbound {
  const aliases: Record<string, string> = { host: 'host', server: 'host', address: 'host', hostname: 'host', ip: 'host', '服务器': 'host', '代理服务器': 'host', '地址': 'host', '主机': 'host', 'ip地址': 'host', port: 'port', '端口': 'port', username: 'user', user: 'user', '用户名': 'user', '账号': 'user', password: 'password', pass: 'password', '密码': 'password', protocol: 'protocol', type: 'protocol', '协议': 'protocol' };
  const lines = value.split(/\r?\n/).filter(line => line.trim());
  const labeled = lines.length > 1 && lines.some(line => {
    const pair = line.match(/^\s*([^:=：]+?)\s*[:=：]/);
    return pair && Object.prototype.hasOwnProperty.call(aliases, pair[1].toLowerCase());
  });
  if (labeled) {
    const fields: ObjectValue = {};
    for (const line of lines) {
      // One optional formatting space after ':'; credential bytes otherwise
      // remain literal. Use a URI when leading/trailing spaces are ambiguous.
      const pair = line.match(/^\s*([^:=：]+?)\s*[:=：][ \t]?(.*)$/);
      const alias = pair?.[1].toLowerCase();
      const key = alias && Object.prototype.hasOwnProperty.call(aliases, alias) ? aliases[alias] : undefined;
      if (!pair || !key) return fail('unsupportedField');
      if (Object.prototype.hasOwnProperty.call(fields, key)) return fail('ambiguousInput');
      fields[key] = pair[2];
    }
    if (fields.protocol !== undefined) {
      const protocol = text(fields.protocol).trim();
      if (!/^socks(?:5h?)?$/i.test(protocol)) return fail('unsupportedProtocol');
    }
    if (fields.port === undefined) {
      const server = endpoint(fields.host);
      const result = socks(server.server, server.port, fields.user, fields.password);
      if (/^socks5h$/i.test(String(fields.protocol || '').trim())) result.warnings.push('platformDNS');
      return result;
    }
    const result = socks(fields.host, text(fields.port).trim(), fields.user, fields.password);
    if (/^socks5h$/i.test(String(fields.protocol || '').trim())) result.warnings.push('platformDNS');
    return result;
  }
  const candidates: ParsedOutbound[] = [], errors: RoutingInputError[] = [];
  const candidate = (read: () => ParsedOutbound) => {
    try { candidates.push(read()); } catch (error) { if (error instanceof RoutingInputError) errors.push(error); else throw error; }
  };
  if (!/[\r\n]/.test(value)) {
    const four = value.match(/^(\[[^\]]+\]|[^:\s]+):(\d+):([^:\s]+):([^\s]+)$/);
    if (four) candidate(() => socks(four[1], four[2], four[3], four[4]));
    if ((value.match(/@/g) || []).length === 1) {
      candidate(() => socksURI('socks5://' + value.trim()));
      candidate(() => {
        const [remote, credentials] = value.split('@'), server = endpoint(remote), colon = credentials.indexOf(':');
        if (colon < 1) return fail('ambiguousInput');
        return socks(server.server, server.port, credentials.slice(0, colon), credentials.slice(colon + 1));
      });
    }
    candidate(() => { const server = endpoint(value); return socks(server.server, server.port); });
    for (const separator of ['|', ',']) {
      const parts = value.split(separator);
      if (parts.length === 4) candidate(() => socks(parts[0], parts[1].trim(), parts[2], parts[3]));
    }
  }
  const parts = value.trim().split(/\s+/);
  if (parts.length === 4) candidate(() => socks(parts[0], parts[1], parts[2], parts[3]));
  if (candidates.length !== 1) {
    if (!candidates.length && errors.some(error => error.code === 'credentialsTooLong')) return fail('credentialsTooLong');
    return fail('ambiguousInput');
  }
  return candidates[0];
}

export function parseOutbound(raw: string): ParsedOutbound | null {
  if (new TextEncoder().encode(raw).length > 16384) return fail('outboundTooLong');
  const value = raw.trim();
  if (!value) return null;
  if (value.startsWith('{') || value.startsWith('[') && !/^\s*\[Interface\]\s*$/m.test(value) && !/^\[[a-f\d:.]+\](?::\d+|[|,\s])/i.test(value)) {
    let object: unknown; try { object = JSON.parse(value); } catch { return fail(); }
    return native(object);
  }
  if (/^\s*\[Interface\]\s*$/m.test(value)) return conf(value);
  if (/^curl(?:\s|$)/i.test(value)) return curlProxy(value);
  if (/^socks(?:5h?)?:\/\//i.test(value)) return socksURI(value);
  if (/^ss:\/\//i.test(value)) {
    if (/\s/.test(value)) return fail();
    let body = value.slice(5).split('#')[0];
    if (body.includes('?')) return fail('unsupportedField');
    let credentials: string, remote: string;
    if (body.includes('@')) {
      if ((body.match(/@/g) || []).length !== 1) return fail('ambiguousInput');
      const at = body.indexOf('@'); credentials = decodeOnce(body.slice(0, at)); remote = body.slice(at + 1);
      if (!credentials.includes(':')) credentials = base64(credentials);
    } else {
      body = base64(decodeOnce(body));
      const at = body.lastIndexOf('@'); if (at < 0) return fail();
      credentials = body.slice(0, at); remote = body.slice(at + 1);
    }
    const split = credentials.indexOf(':'); if (split <= 0) return fail();
    const server = endpoint(remote.replace(/\/$/, ''));
    return ss(server.server, server.port, credentials.slice(0, split), credentials.slice(split + 1));
  }
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(value)) return fail('unsupportedProtocol');
  // Delimited/labeled credential fields are literal, including their spaces.
  // Empty surrounding lines are formatting, not part of a SOCKS password.
  return socksText(raw.trimStart().replace(/(?:\r?\n[ \t]*)+$/, ''));
}

export function normalizeRules(raw: string): string[] {
  const rules: string[] = [];
  raw.split(/\r?\n/).forEach((source, index) => {
    const value = source.trim(); if (!value) return;
    try {
      if (value.length > 255) return fail('invalidRule');
      let normalized: string;
      if (/^(geosite|geoip):[a-z\d][a-z\d_@.!-]*$/i.test(value)) normalized = value.toLowerCase();
      else if (value.includes('/')) normalized = cidr(value);
      else if (ip(value)) normalized = ip(value)!.address;
      else normalized = domain(value);
      if (!rules.includes(normalized)) rules.push(normalized);
    } catch { throw new RoutingInputError('invalidRule', index + 1); }
  });
  if (!rules.length) throw new RoutingInputError('rulesRequired');
  if (rules.length > 200) throw new RoutingInputError('tooManyRules');
  return rules;
}
export function buildEnableRequest(userServiceId: number, outboundText: string, rulesText: string, hasSecret: boolean, existingSummary?: OutboundSummary, savedOutbound = '') {
  // Retaining a saved draft must not replace credentials during a rules-only edit.
  const unchanged = hasSecret && (!outboundText.trim() || outboundText === savedOutbound);
  const parsed = unchanged ? null : parseOutbound(outboundText);
  if (!parsed && !hasSecret) throw new RoutingInputError('outboundRequired');
  const rules = normalizeRules(rulesText);
  const summary = parsed?.summary || existingSummary;
  const secret = parsed ? { outbound: parsed.outbound, outbound_text: outboundText } : undefined;
  if (secret && new TextEncoder().encode(JSON.stringify(secret)).length > 65536) return fail('outboundTooLong');
  return { user_service_id: userServiceId, enabled: true, data: { rules, ...(summary ? { outbound: summary } : {}) }, ...(secret ? { secret } : {}) };
}
export function buildDisableRequest(userServiceId: number) { return { user_service_id: userServiceId, enabled: false }; }
export function draftAfterSave(draft: { outbound: string; rules: string }, saved: RoutingOptions, disable: boolean) {
  return disable ? draft : { outbound: draft.outbound, rules: saved.data.rules.join('\n') };
}
export function readSavedRoutingOutbound(response: unknown): string {
  const envelope = record(response);
  const raw = 'secret' in envelope ? envelope : envelope.data;
  const secret = record(record(Array.isArray(raw) ? raw[0] : raw).secret);
  const parsed = parseOutbound(JSON.stringify(record(secret.outbound)));
  if (!parsed) return fail();
  const original = text(secret.outbound_text);
  const source = parseOutbound(original);
  if (!source || JSON.stringify(source.outbound) !== JSON.stringify(parsed.outbound)) return fail();
  return original;
}
export function readRoutingOptions(response: unknown): RoutingOptions {
  const invalidResponse = (): never => { throw new Error('Invalid service options response'); };
  const envelope = record(response);
  if (!Array.isArray(envelope.data) || envelope.data.length !== 1) return invalidResponse();
  const value = record(envelope.data[0]);
  if (typeof value.supported !== 'boolean' || 'kind' in value
    || (value.status !== undefined && typeof value.status !== 'string')) return invalidResponse();
  if (value.supported && typeof value.feature !== 'string') return invalidResponse();
  if (!value.supported || value.feature !== 'routing') {
    return { supported: false, feature: typeof value.feature === 'string' ? value.feature : '', enabled: false, has_secret: false, data: { rules: [] }, status: 'disabled' };
  }
  if (typeof value.enabled !== 'boolean' || typeof value.has_secret !== 'boolean'
    || typeof value.status !== 'string' || !ROUTING_STATES.has(value.status)
    || (value.error !== undefined && typeof value.error !== 'string')) return invalidResponse();
  const data = record(value.data);
  if ('outbound_summary' in data || (data.rules !== undefined && (!Array.isArray(data.rules) || data.rules.some(item => typeof item !== 'string')))) return invalidResponse();
  const summary = data.outbound as OutboundSummary | undefined;
  let safeSummary: OutboundSummary | undefined;
  if (summary && ['socks', 'shadowsocks', 'wireguard'].includes(summary.protocol)) {
    try { safeSummary = { protocol: summary.protocol, server: host(summary.server), port: integer(summary.port, 1, 65535) }; }
    catch { /* Never display a URL, credentials or arbitrary server text as a summary. */ }
  }
  return {
    supported: true, feature: 'routing',
    enabled: value.enabled, has_secret: value.has_secret,
    data: {
      rules: (data.rules as string[] | undefined) || [],
      ...(safeSummary ? { outbound: safeSummary } : {}),
    },
    status: value.status,
    ...(value.error !== undefined ? { error: routingSyncErrorCode(value.error) } : {}),
  };
}
