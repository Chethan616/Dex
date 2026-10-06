import { describe, expect, it } from 'vitest';
import { buildTree, crumbs, filterTree, taskFiles, type TreeFolder } from '../../../../src/renderer/hub/workspace/docs/fileTree';

/** The Files panel beside a document: the task's files as a tree. */
describe('task file tree', () => {
  const names = (f: TreeFolder): string[] => f.children.map((c) => (c.kind === 'folder' ? `${c.name}/` : c.name));

  it('roots the tree at the folder the files share, folders first', () => {
    const tree = buildTree([
      { name: 'report.docx', path: String.raw`C:\Users\me\Downloads\report.docx` },
      { name: 'chart.png', path: String.raw`C:\Users\me\Downloads\charts\chart.png` },
      { name: 'notes.md', path: 'C:/Users/me/Documents/notes.md' },
    ]);
    expect(tree.name).toBe('me');
    expect(names(tree)).toEqual(['Documents/', 'Downloads/']);
    const downloads = tree.children[1] as TreeFolder;
    expect(names(downloads)).toEqual(['charts/', 'report.docx']);
  });

  it('keeps a single file at the root of its own folder', () => {
    const tree = buildTree([{ name: 'a.txt', path: 'D:/work/a.txt' }]);
    expect(tree.name).toBe('work');
    expect(names(tree)).toEqual(['a.txt']);
  });

  it('filters to matching files and the folders that hold them', () => {
    const tree = buildTree([
      { name: 'Q3-report.pdf', path: 'C:/x/reports/Q3-report.pdf' },
      { name: 'Q4-report.pdf', path: 'C:/x/reports/Q4-report.pdf' },
      { name: 'photo.jpg', path: 'C:/x/pics/photo.jpg' },
    ]);
    const shown = filterTree(tree, 'q3');
    expect(names(shown)).toEqual(['reports/']);
    expect(names(shown.children[0] as TreeFolder)).toEqual(['Q3-report.pdf']);
    expect(filterTree(tree, '   ')).toBe(tree);
  });

  it('lists output files and open documents once each, whatever the slashes or case', () => {
    const files = taskFiles(
      [
        { type: 'file_output', name: 'a.md', path: 'C:/o/a.md', size: 10, mime: 'text/markdown' },
        { type: 'text', content: 'hi' },
        { type: 'file_output', name: 'a.md', path: String.raw`c:\o\A.md`, size: 12, mime: 'text/markdown' },
      ],
      [{ name: 'b.pdf', path: 'C:/d/b.pdf', size: 99 }, { name: 'a.md', path: 'C:/o/a.md', size: 12 }],
    );
    expect(files.map((f) => f.name)).toEqual(['a.md', 'b.pdf']);
    expect(files[0].size).toBe(12);
  });

  it('shortens a long path to its last folders as breadcrumbs', () => {
    expect(crumbs(String.raw`C:\Users\me\Downloads\reports\Q3.pdf`)).toEqual(['…', 'me', 'Downloads', 'reports', 'Q3.pdf']);
    expect(crumbs('D:/a/b.txt')).toEqual(['D:', 'a', 'b.txt']);
  });
});
