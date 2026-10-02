import { describe, expect, it } from 'vitest';
import { chooseConfig } from '../../scripts/lib/choose.js';

const row = (id, downloadMB, exact, totalMs) => ({ id, downloadMB, exact, required: 12, meanCer: 0, totalMs });

describe('chooseConfig', () => {
  it('picks the fastest configuration that reads every label', () => {
    const rows = [row('big', 31, 12, 3000), row('tiny', 6, 11, 700), row('mid', 21.5, 12, 1900), row('small', 20.7, 12, 2400)];
    expect(chooseConfig(rows).id).toBe('mid');
  });

  it('breaks speed ties by download size', () => {
    expect(chooseConfig([row('large', 26, 12, 2000), row('lean', 21, 12, 2000)]).id).toBe('lean');
  });

  it('returns null when nothing reads every label', () => {
    expect(chooseConfig([row('tiny', 6, 11, 700)])).toBeNull();
  });
});
