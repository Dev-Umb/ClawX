export interface TokenUsageHistoryEntry {
  timestamp: string;
  sessionId: string;
  agentId: string;
  model?: string;
  provider?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costUsd?: number;
  pointsSpent?: number;
}

interface TranscriptUsageShape {
  input?: number;
  output?: number;
  total?: number;
  cacheRead?: number;
  cacheWrite?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cost?: {
    total?: number;
  };
  points?: number;
}

type ModelPricing = {
  inputPer1M: number;
  outputPer1M: number;
};

const DEFAULT_PRICING: ModelPricing = {
  inputPer1M: 4,
  outputPer1M: 16,
};
const POINTS_PER_USD = 1000;

const PRICING_RULES: Array<{
  provider?: string;
  modelPrefix: string;
  pricing: ModelPricing;
}> = [
  {
    provider: 'ark',
    modelPrefix: 'doubao-seed-2.0-lite',
    pricing: DEFAULT_PRICING,
  },
  {
    provider: 'ark',
    modelPrefix: 'doubao-seed-2-0-lite',
    pricing: DEFAULT_PRICING,
  },
  {
    provider: 'clawx-cloud',
    modelPrefix: 'doubao-seed-2.0-lite',
    pricing: DEFAULT_PRICING,
  },
  {
    provider: 'clawx-cloud',
    modelPrefix: 'doubao-seed-2-0-lite',
    pricing: DEFAULT_PRICING,
  },
];

interface TranscriptLineShape {
  type?: string;
  timestamp?: string;
  message?: {
    role?: string;
    model?: string;
    modelRef?: string;
    provider?: string;
    usage?: TranscriptUsageShape;
  };
}

export function parseUsageEntriesFromJsonl(
  content: string,
  context: { sessionId: string; agentId: string },
  limit?: number,
): TokenUsageHistoryEntry[] {
  const entries: TokenUsageHistoryEntry[] = [];
  const lines = content.split(/\r?\n/).filter(Boolean);
  const maxEntries = typeof limit === 'number' && Number.isFinite(limit)
    ? Math.max(Math.floor(limit), 0)
    : Number.POSITIVE_INFINITY;

  for (let i = lines.length - 1; i >= 0 && entries.length < maxEntries; i -= 1) {
    let parsed: TranscriptLineShape;
    try {
      parsed = JSON.parse(lines[i]) as TranscriptLineShape;
    } catch {
      continue;
    }

    const message = parsed.message;
    if (!message || message.role !== 'assistant' || !message.usage || !parsed.timestamp) {
      continue;
    }

    const usage = message.usage;
    const inputTokens = usage.input ?? usage.promptTokens ?? 0;
    const outputTokens = usage.output ?? usage.completionTokens ?? 0;
    const cacheReadTokens = usage.cacheRead ?? 0;
    const cacheWriteTokens = usage.cacheWrite ?? 0;
    const totalTokens = usage.total ?? usage.totalTokens ?? inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
    const modelName = message.model ?? message.modelRef;
    const estimatedCostUsd = estimateCostUsd(
      message.provider,
      modelName,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
    );
    const rawCostUsd = usage.cost?.total;
    const costUsd = Number.isFinite(rawCostUsd) && (rawCostUsd as number) > 0
      ? rawCostUsd
      : estimatedCostUsd;
    const rawPointsSpent = usage.points;
    const pointsSpent = Number.isFinite(rawPointsSpent) && (rawPointsSpent as number) > 0
      ? Math.ceil(rawPointsSpent as number)
      : estimatePointsSpent(costUsd);

    if (totalTokens <= 0 && !costUsd && !pointsSpent) {
      continue;
    }

    entries.push({
      timestamp: parsed.timestamp,
      sessionId: context.sessionId,
      agentId: context.agentId,
      model: modelName,
      provider: message.provider,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      totalTokens,
      costUsd,
      pointsSpent,
    });
  }

  return entries;
}

function normalizeModelName(model?: string): string {
  return (model || '').trim().toLowerCase();
}

function normalizeProvider(provider?: string): string {
  return (provider || '').trim().toLowerCase();
}

function estimateCostUsd(
  provider: string | undefined,
  model: string | undefined,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  cacheWriteTokens = 0,
): number | undefined {
  if (inputTokens <= 0 && outputTokens <= 0 && cacheReadTokens <= 0 && cacheWriteTokens <= 0) {
    return undefined;
  }

  const normalizedProvider = normalizeProvider(provider);
  if (normalizedProvider !== 'clawx-cloud' && normalizedProvider !== 'ark') {
    return undefined;
  }
  const normalizedModel = normalizeModelName(model);
  const matchedRule = PRICING_RULES.find((rule) => {
    if (rule.provider && normalizeProvider(rule.provider) !== normalizedProvider) {
      return false;
    }
    return normalizedModel.startsWith(normalizeModelName(rule.modelPrefix));
  });
  const pricing = matchedRule?.pricing ?? DEFAULT_PRICING;
  // Keep estimation consistent with backend deduction:
  // cache read/write tokens are treated as input-priced tokens.
  const billableInputTokens = inputTokens + Math.max(cacheReadTokens, 0) + Math.max(cacheWriteTokens, 0);
  const cost = (billableInputTokens * pricing.inputPer1M + outputTokens * pricing.outputPer1M) / 1_000_000;
  return Number.isFinite(cost) ? cost : undefined;
}

function estimatePointsSpent(costUsd?: number): number | undefined {
  if (!Number.isFinite(costUsd) || (costUsd as number) <= 0) {
    return undefined;
  }
  return Math.ceil((costUsd as number) * POINTS_PER_USD);
}
