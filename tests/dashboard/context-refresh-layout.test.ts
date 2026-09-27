jest.mock('@/lib/config/research-flags', () => ({ RESEARCH_FLAGS: { targets: true } }));
jest.mock('@/lib/targets/service', () => ({
  getCurrentOwnerProfileId: jest.fn(),
  getOrCreateSelfTarget: jest.fn(),
  getResearchTargetState: jest.fn(),
  getTargetById: jest.fn(),
}));

import { DashboardLayout } from '@/components/dashboard/dashboard-layout';
import {
  getCurrentOwnerProfileId, getOrCreateSelfTarget,
  getResearchTargetState, getTargetById,
} from '@/lib/targets/service';
import type { ResearchTarget } from '@/lib/targets/types';

const self: ResearchTarget = {
  id: 'self', tenantId: 'tenant-1', kind: 'self', label: 'Self',
  ownerId: 'owner-1', contactId: null, companyId: null, pinned: false,
  createdAt: '', updatedAt: '', lastUsedAt: '',
};
const contact = (id: string): ResearchTarget => ({
  ...self, id, kind: 'contact', label: id, ownerId: null, contactId: id,
});

describe('dashboard context render', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getCurrentOwnerProfileId as jest.Mock).mockResolvedValue('owner-1');
    (getOrCreateSelfTarget as jest.Mock).mockResolvedValue(self);
    (getTargetById as jest.Mock).mockImplementation(async (id: string) => contact(id));
  });

  it('resolves A then B then self on successive server renders, keeping owner cards once', async () => {
    const comparisons: string[] = [];
    const comparisonSlot = (owner: ResearchTarget, focused: ResearchTarget) => {
      comparisons.push(`${owner.id}:${focused.id}`);
      return `comparison:${focused.id}`;
    };
    for (const id of ['A', 'B', null]) {
      (getResearchTargetState as jest.Mock).mockResolvedValueOnce({
        primaryTargetId: self.id, secondaryTargetId: id,
      });
      const rendered = await DashboardLayout({ comparisonSlot, ownerWideSlot: 'owner-cards' });
      const children = (rendered as { props: { children: unknown[] } }).props.children;
      expect(children.filter((child) => child === 'owner-cards')).toHaveLength(1);
      expect(children.filter((child) => child === `comparison:${id}`)).toHaveLength(id ? 1 : 0);
    }
    expect(comparisons).toEqual(['self:A', 'self:B']);
  });
});
