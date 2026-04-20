// Functional core: Wikidata entity fetcher. Pure apart from the single fetch() call.

export interface WikidataEntity {
  qid: string;
  label: string;
  description: string;
  instanceOf: string[];
}

interface WikidataResponse {
  entities: Record<string, RawEntity>;
}

interface RawEntity {
  labels?: Record<string, { value: string }>;
  descriptions?: Record<string, { value: string }>;
  claims?: Record<string, Array<{
    mainsnak?: { datavalue?: { value?: { id?: string } } };
  }>>;
}

export async function fetchWikidataEntity(qid: string): Promise<WikidataEntity> {
  const url = `https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`;
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'friski-scaffolder/0.0' },
  });
  if (!response.ok) {
    throw new Error(`Wikidata fetch for ${qid} failed: HTTP ${response.status}`);
  }

  const json = (await response.json()) as WikidataResponse;
  const entity = json.entities?.[qid];
  if (!entity) throw new Error(`Entity ${qid} not found in response`);

  const label = entity.labels?.en?.value ?? qid;
  const description = entity.descriptions?.en?.value ?? '';
  const instanceOf: string[] = [];
  for (const claim of entity.claims?.P31 ?? []) {
    const id = claim.mainsnak?.datavalue?.value?.id;
    if (id) instanceOf.push(id);
  }

  return { qid, label, description, instanceOf };
}
