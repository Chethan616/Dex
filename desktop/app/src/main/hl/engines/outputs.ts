/**
 * Files that land in outputs/ but aren't results: Blender's save-in-progress
 * (`scene.blend@`) and backups (`.blend1`), editor/Office lock and swap
 * files, half-finished downloads. Recording them put junk (and 0-byte
 * entries) in the task's file list — on the phone too.
 */
export function isScratchFile(name: string): boolean {
  const base = name.split(/[\\/]/).pop() ?? name;
  return /@$/.test(base)
    || /\.blend\d+$/i.test(base)
    || /^~\$|^\.~lock\.|^\.#/.test(base)
    || /\.(tmp|temp|part|crdownload|download|swp|swo|lock)$/i.test(base)
    || base.endsWith('~');
}
