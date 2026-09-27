// SSRF guard — private-IP classification tests.
//
// Pins:
//   1. RFC 1918 CIDR coverage (10/8, 172.16/12, 192.168/16) for IPv4.
//   2. Loopback (127/8), link-local (169.254/16), multicast (224/4).
//   3. IPv6 loopback (::1), link-local (fe80::/10), unique-local (fc00::/7),
//      multicast (ff00::/8), IPv4-mapped (::ffff:a.b.c.d).
//   4. Literal-IP URLs block via `checkUrlSafe`.
//   5. DNS-resolved hostnames: when the lookup returns a private IP the
//      host is blocked; when it returns a public IP the host passes.
//   6. `SOURCES_ALLOW_LOCALHOST=true` whitelists `localhost` + 127/8 + ::1
//      (and only those).

import {
  classifyIPv4,
  classifyIPv6,
  classifyIp,
  checkHostSafe,
  checkUrlSafe,
} from '@/lib/sources/private-ip';

describe('sources/private-ip classification', () => {
  const originalEnv = process.env.SOURCES_ALLOW_LOCALHOST;
  afterEach(() => {
    process.env.SOURCES_ALLOW_LOCALHOST = originalEnv;
  });

  it('classifies 10/8 as private_ip', () => {
    expect(classifyIPv4('10.0.0.1')).toBe('private_ip');
    expect(classifyIPv4('10.255.255.254')).toBe('private_ip');
  });

  it('classifies 172.16/12 edges precisely', () => {
    expect(classifyIPv4('172.15.0.1')).toBeNull();
    expect(classifyIPv4('172.16.0.1')).toBe('private_ip');
    expect(classifyIPv4('172.31.255.254')).toBe('private_ip');
    expect(classifyIPv4('172.32.0.1')).toBeNull();
  });

  it('classifies 192.168/16 as private_ip', () => {
    expect(classifyIPv4('192.168.1.1')).toBe('private_ip');
    expect(classifyIPv4('192.167.255.254')).toBeNull();
  });

  it('classifies 127/8 as loopback (default blocked)', () => {
    process.env.SOURCES_ALLOW_LOCALHOST = 'false';
    expect(classifyIPv4('127.0.0.1')).toBe('loopback');
    expect(classifyIPv4('127.42.17.3')).toBe('loopback');
  });

  it('classifies 169.254/16 as link_local', () => {
    expect(classifyIPv4('169.254.169.254')).toBe('link_local');
  });

  it('classifies 224.0.0.0/4 as multicast', () => {
    expect(classifyIPv4('224.0.0.1')).toBe('multicast');
    expect(classifyIPv4('239.255.255.255')).toBe('multicast');
  });

  it('classifies public IPs as OK', () => {
    expect(classifyIPv4('8.8.8.8')).toBeNull();
    expect(classifyIPv4('93.184.216.34')).toBeNull();
  });

  it('classifies IPv6 loopback, link-local, unique-local, multicast', () => {
    expect(classifyIPv6('::1')).toBe('loopback');
    expect(classifyIPv6('fe80::1')).toBe('link_local');
    expect(classifyIPv6('fc00::1')).toBe('private_ip');
    expect(classifyIPv6('fd12::1')).toBe('private_ip');
    expect(classifyIPv6('ff02::1')).toBe('multicast');
  });

  it('maps IPv4-mapped IPv6 to the IPv4 table', () => {
    expect(classifyIPv6('::ffff:10.0.0.1')).toBe('private_ip');
    expect(classifyIPv6('::ffff:8.8.8.8')).toBeNull();
    expect(classifyIPv6('::ffff:0a00:0001')).toBe('private_ip');
    expect(classifyIPv6('::ffff:7f00:0001')).toBe('loopback');
    expect(classifyIPv6('::10.0.0.1')).toBe('private_ip');
  });

  it('classifyIp routes to v4 or v6 automatically', () => {
    expect(classifyIp('10.0.0.1')).toBe('private_ip');
    expect(classifyIp('fe80::1')).toBe('link_local');
    expect(classifyIp('not-an-ip')).toBe('invalid_host');
  });

  it('respects SOURCES_ALLOW_LOCALHOST=true for 127/8 + ::1 only', () => {
    process.env.SOURCES_ALLOW_LOCALHOST = 'true';
    expect(classifyIPv4('127.0.0.1')).toBeNull();
    expect(classifyIPv6('::1')).toBeNull();
    // Other private ranges still blocked.
    expect(classifyIPv4('10.0.0.1')).toBe('private_ip');
    expect(classifyIPv6('fe80::1')).toBe('link_local');
  });
});

describe('sources/private-ip checkHostSafe', () => {
  it('blocks literal private-IP hosts without calling DNS', async () => {
    const lookup = jest.fn();
    const r = await checkHostSafe('10.0.0.1', lookup);
    expect(r.blocked).toBe(true);
    expect(r.reason).toBe('private_ip');
    expect(lookup).not.toHaveBeenCalled();
  });

  it('blocks literal loopback URL host', async () => {
    const r = await checkUrlSafe('http://127.0.0.1:8080/admin', async () => []);
    expect(r.blocked).toBe(true);
    expect(r.reason).toBe('loopback');
  });

  it('blocks hostname that resolves to a private IP', async () => {
    const r = await checkHostSafe('metadata.internal', async () => [
      { address: '169.254.169.254', family: 4 },
    ]);
    expect(r.blocked).toBe(true);
    expect(r.reason).toBe('link_local');
    expect(r.resolvedIp).toBe('169.254.169.254');
  });

  it('allows hostname that resolves to a public IP', async () => {
    const r = await checkHostSafe('example.com', async () => [
      { address: '93.184.216.34', family: 4 },
    ]);
    expect(r.blocked).toBe(false);
    expect(r.resolvedIp).toBe('93.184.216.34');
  });

  it('blocks when DNS returns any private IP even if other records are public', async () => {
    const r = await checkHostSafe('dual-a.example.com', async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ]);
    expect(r.blocked).toBe(true);
    expect(r.reason).toBe('private_ip');
  });

  it('blocks unresolvable hosts', async () => {
    const r = await checkHostSafe('nope.invalid', async () => {
      throw new Error('ENOTFOUND');
    });
    expect(r.blocked).toBe(true);
    expect(r.reason).toBe('invalid_host');
  });

  it('localhost hostname blocked by default', async () => {
    delete process.env.SOURCES_ALLOW_LOCALHOST;
    const r = await checkHostSafe('localhost', async () => []);
    expect(r.blocked).toBe(true);
    expect(r.reason).toBe('loopback');
  });

  it('localhost hostname allowed when SOURCES_ALLOW_LOCALHOST=true', async () => {
    process.env.SOURCES_ALLOW_LOCALHOST = 'true';
    const r = await checkHostSafe('localhost', async () => []);
    expect(r.blocked).toBe(false);
    expect(r.resolvedIp).toBe('127.0.0.1');
  });
});
