import { describe, expect, it } from 'vitest';
import { chooseConfig } from '../../scripts/lib/choose.js';

const row = (id, downloadMB, exact, totalMs) => ({ id, downloadMB, exact, required: 12, meanCer: 0, totalMs });

describe('chooseConfig', () => {
  it('picks the smallest download among configurations that read every label', () => {
    const rows = [row('big', 31, 12, 3000), row('tiny', 6, 11, 700), row('mid', 21, 12, 2200)];
    expect(chooseConfig(rows).id).toBe('mid');
  });

  it('breaks download ties by speed', () => {
    expect(chooseConfig([row('slow', 21, 12, 2600), row('fast', 21, 12, 2200)]).id).toBe('fast');
  });

  it('returns null when nothing reads every label', () => {
    expect(chooseConfig([row('tiny', 6, 11, 700)])).toBeNull();
  });
});
