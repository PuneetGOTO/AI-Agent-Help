import type { Tool } from '@prisma/client';
import { safeToolView } from '../src/modules/tools/tool-view';

describe('safeToolView', () => {
  it('never returns executable configuration or static headers', () => {
    const tool = {
      id: 'tool-1',
      config: { url: 'https://example.com/hook', headers: { 'X-Secret': 'value' } },
    } as unknown as Tool;

    expect(safeToolView(tool)).toEqual(
      expect.objectContaining({ id: 'tool-1', hasConfiguration: true }),
    );
    expect(safeToolView(tool)).not.toHaveProperty('config');
  });
});
