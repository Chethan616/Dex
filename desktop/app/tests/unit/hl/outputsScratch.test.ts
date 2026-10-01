import { describe, expect, it } from 'vitest';
import { isScratchFile } from '../../../src/main/hl/engines/outputs';

describe('outputs recorder', () => {
  it('skips scratch files but keeps real results', () => {
    for (const junk of ['house.blend@', 'house.blend1', 'house.blend2', '~$report.docx', '.~lock.sheet.ods#', 'video.mp4.part', 'x.crdownload', 'notes.txt~', 'a.tmp']) {
      expect(isScratchFile(junk), junk).toBe(true);
    }
    for (const real of ['house.blend', 'house.glb', 'render.png', 'report.docx', 'C:\out\house.glb', 'data.csv']) {
      expect(isScratchFile(real), real).toBe(false);
    }
  });
});
