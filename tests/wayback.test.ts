import { describe, expect, test, vi, afterEach } from 'vitest';
import { captureViaWayback } from '../src/lib/wayback';

afterEach(() => vi.restoreAllMocks());

describe('captureViaWayback', () => {
  test('submits URL, polls, returns snapshot URL on success', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    // Call 1: POST /save/ returns job_id.
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ job_id: 'job-123' }), { status: 200 }),
    );
    // Call 2: first poll — still pending.
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 'pending' }), { status: 200 }),
    );
    // Call 3: second poll — success with timestamp.
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: 'success',
          timestamp: '20260420153000',
          original_url: 'https://missionlocal.org/example',
        }),
        { status: 200 },
      ),
    );

    const result = await captureViaWayback('https://missionlocal.org/example', {
      pollIntervalMs: 1,
      timeoutMs: 5000,
    });

    expect(result.archivedUrl).toBe(
      'https://web.archive.org/web/20260420153000/https://missionlocal.org/example',
    );
    expect(result.timestamp).toBe('20260420153000');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test('throws on SPN error status', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ job_id: 'job-456' }), { status: 200 }),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 'error', message: 'robots.txt blocks' }), {
        status: 200,
      }),
    );

    await expect(
      captureViaWayback('https://blocked.example.org/', { pollIntervalMs: 1, timeoutMs: 5000 }),
    ).rejects.toThrow(/robots/);
  });

  test('adds Authorization header when S3 keys provided', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ job_id: 'job-789' }), { status: 200 }),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ status: 'success', timestamp: '20260420', original_url: 'https://x.y/' }),
        { status: 200 },
      ),
    );

    await captureViaWayback('https://x.y/', {
      pollIntervalMs: 1,
      s3Key: 'KEY',
      s3Secret: 'SECRET',
    });

    const firstCall = fetchMock.mock.calls[0]!;
    const init = firstCall[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('LOW KEY:SECRET');
  });
});
