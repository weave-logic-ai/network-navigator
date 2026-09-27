jest.mock('@/lib/scoring/pipeline', () => ({
  assertOwnerBaseline: jest.fn(), captureOwnerScoringBasis: jest.fn(), scoreContact: jest.fn(),
}));
jest.mock('@/lib/db/queries/scoring', () => ({}));

import { captureOwnerScoringBasis, scoreContact } from '@/lib/scoring/pipeline';
import { triggerBatchAutoScore } from '@/lib/scoring/auto-score';

describe('import auto-score basis', () => {
  beforeEach(() => {
    (captureOwnerScoringBasis as jest.Mock).mockReset();
    (scoreContact as jest.Mock).mockReset();
  });

  it('uses one captured owner basis even when settings change after the first contact', async () => {
    const captured = { basisHash: 'owner-a' };
    const changed = { basisHash: 'owner-b' };
    let settings = captured;
    (captureOwnerScoringBasis as jest.Mock).mockImplementation(async () => settings);
    (scoreContact as jest.Mock).mockImplementation(async () => { settings = changed; });
    triggerBatchAutoScore(['a', 'b', 'c', 'd', 'e', 'f']);
    await new Promise(resolve => setImmediate(resolve));
    expect(captureOwnerScoringBasis).toHaveBeenCalledTimes(1);
    expect(scoreContact).toHaveBeenCalledTimes(6);
    expect((scoreContact as jest.Mock).mock.calls.every(call => call[3] === captured)).toBe(true);
  });
});
