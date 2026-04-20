import { vi } from 'vitest';
import { z } from 'zod';

// Mock Astro modules for test environment
vi.doMock('astro:content', () => ({
  defineCollection: (config: any) => config,
}));

vi.doMock('astro/loaders', () => ({
  glob: (pattern: any) => pattern,
}));

vi.doMock('astro/zod', () => ({
  z: z,
}));
