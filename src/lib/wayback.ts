// Functional core: Wayback Save Page Now client (submit + poll). Network-bound at the fetch call.

export interface CaptureResult {
  originalUrl: string;
  archivedUrl: string;
  timestamp: string;
  jobId: string;
}

export interface CaptureOptions {
  s3Key?: string;
  s3Secret?: string;
  timeoutMs?: number;       // default 120000 (2 min)
  pollIntervalMs?: number;  // default 5000
}

interface SubmitResponse { job_id: string }

interface StatusResponse {
  status: 'pending' | 'success' | 'error';
  timestamp?: string;
  original_url?: string;
  message?: string;
}

const SPN_SUBMIT = 'https://web.archive.org/save/';
const SPN_STATUS = (jobId: string) => `https://web.archive.org/save/status/${jobId}`;

function authHeaders(opts: CaptureOptions): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.s3Key && opts.s3Secret) {
    headers['Authorization'] = `LOW ${opts.s3Key}:${opts.s3Secret}`;
  }
  return headers;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function captureViaWayback(
  url: string,
  opts: CaptureOptions = {},
): Promise<CaptureResult> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const pollIntervalMs = opts.pollIntervalMs ?? 5_000;
  const headers = authHeaders(opts);

  const body = new URLSearchParams({ url, capture_outlinks: '0' });
  const submit = await fetch(SPN_SUBMIT, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!submit.ok) {
    throw new Error(`Wayback submit failed: HTTP ${submit.status}`);
  }
  const { job_id: jobId } = (await submit.json()) as SubmitResponse;
  if (!jobId) throw new Error('Wayback submit response missing job_id');

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(pollIntervalMs);
    const status = await fetch(SPN_STATUS(jobId), { headers });
    if (!status.ok) continue; // transient — retry
    const info = (await status.json()) as StatusResponse;

    if (info.status === 'success' && info.timestamp && info.original_url) {
      return {
        originalUrl: info.original_url,
        archivedUrl: `https://web.archive.org/web/${info.timestamp}/${info.original_url}`,
        timestamp: info.timestamp,
        jobId,
      };
    }
    if (info.status === 'error') {
      throw new Error(`Wayback capture failed: ${info.message ?? 'unknown error'} (job ${jobId})`);
    }
  }

  throw new Error(`Wayback capture timed out after ${timeoutMs}ms (job ${jobId})`);
}
