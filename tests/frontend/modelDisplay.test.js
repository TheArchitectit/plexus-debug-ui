import { describe, it, expect } from 'vitest';
import { modelDisplay } from '../../src/lib/modelDisplay.js';

describe('modelDisplay', () => {
  it('shows the served model and requested alias when routing changed the model', () => {
    const d = modelDisplay({
      incoming_model_alias: 'claude-sonnet-5',
      canonical_model_name: 'claude-sonnet-4-6',
      selected_model_name: 'MiniMaxAI/MiniMax-M3',
    });
    expect(d.served).toBe('MiniMaxAI/MiniMax-M3');
    expect(d.requested).toBe('claude-sonnet-5');
    expect(d.different).toBe(true);
  });

  it('prefers final_attempt_model after retries', () => {
    const d = modelDisplay({
      incoming_model_alias: 'claude-sonnet-5',
      canonical_model_name: 'claude-sonnet-4-6',
      selected_model_name: 'zai-org/GLM-5.1-FP8',
      final_attempt_model: 'meituan/longcat-2.0:free',
    });
    expect(d.served).toBe('meituan/longcat-2.0:free');
  });

  it('reports no difference when the request was served as asked', () => {
    const d = modelDisplay({
      incoming_model_alias: 'claude-sonnet-4-6',
      canonical_model_name: 'claude-sonnet-4-6',
      selected_model_name: 'claude-sonnet-4-6',
    });
    expect(d.served).toBe('claude-sonnet-4-6');
    expect(d.different).toBe(false);
  });

  it('treats alias-vs-canonical-only differences as the same model', () => {
    const d = modelDisplay({
      incoming_model_alias: 'hf:zai-org/GLM-5',
      canonical_model_name: 'zai-org/GLM-5.1-FP8',
      selected_model_name: 'zai-org/GLM-5.1-FP8',
    });
    expect(d.different).toBe(false);
  });

  it('handles missing fields', () => {
    expect(modelDisplay({}).served).toBe('');
    expect(modelDisplay({ incoming_model_alias: 'x' }).served).toBe('x');
  });
});
