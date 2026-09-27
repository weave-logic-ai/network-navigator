import http from 'node:http';
import type { AddressInfo } from 'node:net';
import zlib from 'node:zlib';
import { safeHttpGet } from '@/lib/sources/safe-http';

describe('safe source HTTP transport', () => {
  let server: http.Server;
  let port: number;
  const seenHeaders: Array<http.IncomingHttpHeaders> = [];
  const priorLocalhost = process.env.SOURCES_ALLOW_LOCALHOST;

  beforeAll(async () => {
    process.env.SOURCES_ALLOW_LOCALHOST = 'true';
    server = http.createServer((req, res) => {
      seenHeaders.push(req.headers);
      if (req.url === '/redirect-private') {
        res.writeHead(302, { Location: 'http://10.0.0.1/private' });
        res.end();
      } else if (req.url === '/redirect-safe') {
        res.writeHead(302, { Location: '/ok' });
        res.end();
      } else if (req.url === '/redirect-cross') {
        res.writeHead(302, { Location: `http://second.invalid:${port}/ok` });
        res.end();
      } else if (req.url === '/gzip-robots') {
        res.writeHead(200, { 'Content-Encoding': 'gzip' });
        res.end(zlib.gzipSync('User-agent: *\nDisallow: /\n'));
      } else if (req.url === '/gzip-bomb') {
        res.writeHead(200, { 'Content-Encoding': 'gzip' });
        res.end(zlib.gzipSync('x'.repeat(4096)));
      } else if (req.url === '/slow') {
        res.writeHead(200);
        res.write('one');
      } else if (req.url === '/large') {
        res.writeHead(200);
        res.end('x'.repeat(4096));
      } else {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (priorLocalhost === undefined) delete process.env.SOURCES_ALLOW_LOCALHOST;
    else process.env.SOURCES_ALLOW_LOCALHOST = priorLocalhost;
  });

  const options = () => ({ maxBytes: 1024, timeoutMs: 2000 });

  it('pins the checked DNS address at connection time', async () => {
    const dnsLookup = jest.fn(async () => [{ address: '127.0.0.1', family: 4 }]);
    const result = await safeHttpGet(`http://not-in-system-dns.invalid:${port}/ok`, {
      ...options(), dnsLookup,
    });
    expect(result.bytes.toString()).toBe('ok');
    expect(dnsLookup).toHaveBeenCalledTimes(1);
  });

  it('checks every redirect target before opening its socket', async () => {
    await expect(safeHttpGet(`http://127.0.0.1:${port}/redirect-private`, options()))
      .rejects.toMatchObject({ code: 'BLOCKED_IP', reason: 'private_ip' });
  });

  it('follows a safe redirect and exposes the final URL', async () => {
    const beforeRequest = jest.fn(async () => undefined);
    const result = await safeHttpGet(`http://127.0.0.1:${port}/redirect-safe`, {
      ...options(), beforeRequest,
    });
    expect(result.bytes.toString()).toBe('ok');
    expect(result.finalUrl).toBe(`http://127.0.0.1:${port}/ok`);
    expect(beforeRequest.mock.calls).toHaveLength(2);
  });

  it('does not forward caller credentials to a different origin', async () => {
    seenHeaders.length = 0;
    const result = await safeHttpGet(`http://first.invalid:${port}/redirect-cross`, {
      ...options(),
      headers: { Authorization: 'Bearer secret', Cookie: 'session=secret', 'X-Api-Key': 'secret' },
      dnsLookup: async () => [{ address: '127.0.0.1', family: 4 }],
    });
    expect(result.bytes.toString()).toBe('ok');
    expect(seenHeaders).toHaveLength(2);
    expect(seenHeaders[0].authorization).toBe('Bearer secret');
    expect(seenHeaders[1].authorization).toBeUndefined();
    expect(seenHeaders[1].cookie).toBeUndefined();
    expect(seenHeaders[1]['x-api-key']).toBeUndefined();
  });

  it('decompresses robots rules before a parser sees them', async () => {
    const result = await safeHttpGet(`http://127.0.0.1:${port}/gzip-robots`, options());
    expect(result.bytes.toString()).toBe('User-agent: *\nDisallow: /\n');
  });

  it('enforces the size cap after decompression', async () => {
    await expect(safeHttpGet(`http://127.0.0.1:${port}/gzip-bomb`, options()))
      .rejects.toMatchObject({ code: 'TOO_LARGE' });
  });

  it('times out an unresolved DNS lookup before any socket is opened', async () => {
    await expect(safeHttpGet('http://never.invalid/', {
      ...options(), timeoutMs: 10, dnsLookup: () => new Promise(() => undefined),
    })).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('applies a whole-response deadline to a stalled body', async () => {
    await expect(safeHttpGet(`http://127.0.0.1:${port}/slow`, {
      ...options(), timeoutMs: 25,
    })).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('stops reading when the streamed body exceeds the cap', async () => {
    await expect(safeHttpGet(`http://127.0.0.1:${port}/large`, options()))
      .rejects.toMatchObject({ code: 'TOO_LARGE' });
  });

  it('rejects non-HTTP schemes before network access', async () => {
    await expect(safeHttpGet('file:///etc/passwd', options()))
      .rejects.toMatchObject({ code: 'INVALID_URL' });
  });
});
