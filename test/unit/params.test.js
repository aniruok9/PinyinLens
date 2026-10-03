import { describe, expect, it } from 'vitest';
import { chooseModels, readParams } from '../../src/app/params.js';

const manifest = {
  det: { 'v6-tiny': {}, 'v6-small': {} },
  rec: { 'v6-tiny': {}, 'v6-small': {} },
  default: { det: 'v6-tiny', rec: 'v6-tiny', longSide: 960 },
};

describe('readParams', () => {
  it('reads img, det, rec and the debug flag', () => {
    expect(readParams('?img=/x.png&det=v6-small&debug')).toEqual({ img: '/x.png', det: 'v6-small', rec: null, debug: true });
    expect(readParams('')).toEqual({ img: null, det: null, rec: null, debug: false });
  });
});

describe('chooseModels', () => {
  it('uses the manifest default when nothing is requested', () => {
    expect(chooseModels(readParams(''), manifest)).toEqual({ det: 'v6-tiny', rec: 'v6-tiny', rejected: [] });
  });

  it('honours shipped overrides and reports unknown ones', () => {
    expect(chooseModels(readParams('?rec=v6-small&det=v9'), manifest)).toEqual({
      det: 'v6-tiny',
      rec: 'v6-small',
      rejected: ['det=v9'],
    });
  });
});
