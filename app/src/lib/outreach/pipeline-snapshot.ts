export interface PipelineSnapshot<T> {
  campaignId: string;
  stages: Record<string, T[]>;
}

/** Owns the current board request, including refreshes after a stage move. */
export class PipelineSnapshotLoader<T> {
  private campaignId = '';
  private generation = 0;
  private controller: AbortController | null = null;

  constructor(
    private readonly onLoading: (campaignId: string) => void,
    private readonly onSnapshot: (snapshot: PipelineSnapshot<T>) => void,
    private readonly onError: (campaignId: string) => void,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  select(campaignId: string): void {
    this.campaignId = campaignId;
    this.load(campaignId);
  }

  refresh(campaignId: string): void {
    if (campaignId === this.campaignId) this.load(campaignId);
  }

  isSelected(campaignId: string): boolean {
    return campaignId === this.campaignId;
  }

  dispose(): void {
    this.generation++;
    this.controller?.abort();
    this.controller = null;
  }

  private async load(campaignId: string): Promise<void> {
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const generation = ++this.generation;
    this.onLoading(campaignId);
    try {
      const query = campaignId ? `?campaign_id=${encodeURIComponent(campaignId)}` : '';
      const response = await this.fetcher(`/api/outreach/pipeline${query}`, {
        cache: 'no-store', signal: controller.signal,
      });
      if (!response.ok) throw new Error('Could not load the pipeline');
      const json = await response.json();
      if (generation === this.generation && campaignId === this.campaignId && !controller.signal.aborted) {
        this.onSnapshot({ campaignId, stages: json.stages ?? {} });
      }
    } catch {
      if (generation === this.generation && campaignId === this.campaignId && !controller.signal.aborted) {
        this.onError(campaignId);
      }
    }
  }
}
