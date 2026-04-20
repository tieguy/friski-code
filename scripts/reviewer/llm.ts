import Anthropic from '@anthropic-ai/sdk';
import yaml from 'js-yaml';
import type { FindingVerdict } from './types';

export const REVIEWER_MODEL = 'claude-sonnet-4-6';
export const REVIEWER_TEMPERATURE = 0;
export const REVIEWER_MAX_TOKENS = 4096;

const VALID_VERDICTS: ReadonlyArray<FindingVerdict> = [
  'verified-high',
  'verified-low',
  'plausible',
  'unverifiable',
  'suspect',
  'incorrect',
];

export interface CallOptions {
  systemPrompt: string;
  cachedSystemContext?: string;  // e.g., editorial-principles.md — gets cache_control
  userPrompt: string;
}

export interface RawFinding {
  verdict: FindingVerdict;
  message: string;
  assertion?: string;
  quote?: string;
  line?: number;
}

export interface LLMClient {
  callForFindings(opts: CallOptions): Promise<{ findings: RawFinding[]; errors: string[] }>;
}

export function makeLLMClient(apiKey: string = process.env.ANTHROPIC_API_KEY ?? ''): LLMClient {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  const client = new Anthropic({ apiKey });

  return {
    async callForFindings(opts) {
      // Every stable system block gets cache_control. Anthropic allows up to 4
      // cache breakpoints per request; we use at most 2 here. Blocks below the
      // model's minimum cacheable size (Sonnet: 1024 tokens) are a no-op —
      // that's fine, it costs nothing to mark them.
      const system: Anthropic.TextBlockParam[] = [{
        type: 'text',
        text: opts.systemPrompt,
        cache_control: { type: 'ephemeral' },
      }];
      if (opts.cachedSystemContext) {
        system.push({
          type: 'text',
          text: opts.cachedSystemContext,
          cache_control: { type: 'ephemeral' },
        });
      }

      const response = await client.messages.create({
        model: REVIEWER_MODEL,
        max_tokens: REVIEWER_MAX_TOKENS,
        temperature: REVIEWER_TEMPERATURE,
        system,
        messages: [{ role: 'user', content: opts.userPrompt }],
      });

      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n');

      return parseFindings(text);
    },
  };
}

// Parse the YAML block from a response. Accept both `findings: []` and bare list forms.
// If parsing fails, return an error (don't throw) — the caller will surface it.
export function parseFindings(text: string): { findings: RawFinding[]; errors: string[] } {
  // Extract YAML: either wrapped in ```yaml ... ``` or the entire message.
  const fenceMatch = text.match(/```(?:yaml)?\s*\n([\s\S]*?)\n```/);
  const yamlText = fenceMatch ? fenceMatch[1]! : text;

  let parsed: unknown;
  try {
    parsed = yaml.load(yamlText);
  } catch (e) {
    return { findings: [], errors: [`YAML parse error: ${(e as Error).message}`] };
  }

  if (parsed == null) return { findings: [], errors: [] };

  const list = Array.isArray(parsed)
    ? parsed
    : (parsed as { findings?: unknown }).findings;

  if (!Array.isArray(list)) {
    return { findings: [], errors: ['Response did not contain an array of findings'] };
  }

  const findings: RawFinding[] = [];
  const errors: string[] = [];
  for (const raw of list) {
    if (typeof raw !== 'object' || raw === null) continue;
    const f = raw as Record<string, unknown>;
    if (typeof f.message !== 'string') {
      errors.push(`Skipping finding without message: ${JSON.stringify(f)}`);
      continue;
    }
    // Fall back to `plausible` (the middle/ambiguous verdict) when the model
    // emits something we don't recognize. This is a deliberately soft default:
    // unrecognized verdicts should surface to the reviewer, not be silently
    // dropped, but shouldn't be escalated to `suspect` or `incorrect` either.
    const verdict: FindingVerdict =
      typeof f.verdict === 'string' && (VALID_VERDICTS as readonly string[]).includes(f.verdict)
        ? (f.verdict as FindingVerdict)
        : 'plausible';
    findings.push({
      verdict,
      message: f.message,
      assertion: typeof f.assertion === 'string' ? f.assertion : undefined,
      quote: typeof f.quote === 'string' ? f.quote : undefined,
      line: typeof f.line === 'number' ? f.line : undefined,
    });
  }

  return { findings, errors };
}
