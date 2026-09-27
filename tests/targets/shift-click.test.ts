import { isShiftClick, setSecondaryTargetViaShiftClick } from '@/components/network/shift-click';
import { contextController } from '@/lib/targets/context-controller';

jest.mock('@/lib/targets/context-controller', () => ({ contextController: { createAndFocus: jest.fn() } }));
const createAndFocus = contextController.createAndFocus as jest.Mock;

describe('graph shift-click', () => {
  beforeEach(() => createAndFocus.mockReset());
  it('recognizes a shifted mouse event', () => {
    expect(isShiftClick({ original: { shiftKey: true } as MouseEvent })).toBe(true);
    expect(isShiftClick({ original: { shiftKey: false } as MouseEvent })).toBe(false);
  });
  it('queues target creation and reports the confirmed focus', async () => {
    createAndFocus.mockResolvedValue({ secondaryTargetId: 'target-new' });
    await expect(setSecondaryTargetViaShiftClick('contact-abc')).resolves.toEqual({ ok: true, secondaryTargetId: 'target-new' });
    expect(createAndFocus).toHaveBeenCalledWith('contact', 'contact-abc');
  });
  it('does not report success on a failed action', async () => {
    createAndFocus.mockRejectedValue(new Error('offline'));
    await expect(setSecondaryTargetViaShiftClick('contact-abc')).resolves.toEqual({ ok: false });
  });
});
