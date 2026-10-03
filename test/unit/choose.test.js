import { describe, expect, it } from 'vitest';
import { chooseConfig } from '../../scripts/lib/choose.js';

const row = (id, downloadMB, exact, totalMs) => ({ id, downloadMB, exact, required: 100, meanCer: 0, totalMs });

describe('chooseConfig', () => {
  it('picks the fastest configuration that reads at least 90% of labels', () => {
    const rows = [row('big', 31, 97, 3000), row('sloppy', 6, 89, 600), row('mid', 21.5, 95, 1900), row('small', 20.7, 93, 2400)];
    expect(chooseConfig(rows).id).toBe('mid');
  });

  it('accepts exactly 90%', () => {
    expect(chooseConfig([row('edge', 6, 90, 700)]).id).toBe('edge');
  });

  it('breaks speed ties by download size', () => {
    expect(chooseConfig([row('large', 26, 95, 2000), row('lean', 21, 95, 2000)]).id).toBe('lean');
  });

  it('returns null when nothing reads 90% of labels', () => {
    expect(chooseConfig([row('sloppy', 6, 89, 700)])).toBeNull();
  });
});
