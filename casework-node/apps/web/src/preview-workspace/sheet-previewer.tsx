import { useEffect, useMemo, useState } from 'react';

import { fetchArrayBuffer } from '../api';
import type { MediaItem } from '../types';

type SheetPreviewerProps = {
  item: MediaItem;
  token: string;
};

type PreviewCell = {
  display: string;
};

type PreviewSheet = {
  id: string;
  name: string;
  rowCount: number;
  columnCount: number;
  cells: Record<number, Record<number, PreviewCell>>;
  rowMeta: Record<number, { height?: number; hidden?: boolean }>;
  columnMeta: Record<number, { width?: number; hidden?: boolean }>;
  merges: Array<{
    startRow: number;
    endRow: number;
    startColumn: number;
    endColumn: number;
  }>;
};

type MaybeWorkbook = {
  SheetNames?: string[];
  Sheets?: Record<string, Record<string, unknown> | undefined>;
};

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, '');
}

function toColumnLabel(index: number): string {
  let current = index + 1;
  let label = '';
  while (current > 0) {
    const remainder = (current - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    current = Math.floor((current - 1) / 26);
  }
  return label;
}

function normalizeSheetCell(cell: Record<string, unknown> | undefined): PreviewCell | null {
  if (!cell) {
    return null;
  }

  const rawValue = cell.v;
  const display =
    typeof cell.w === 'string'
      ? cell.w
      : typeof rawValue === 'string'
        ? rawValue
        : typeof cell.h === 'string'
          ? stripHtml(cell.h)
          : rawValue == null
            ? ''
            : String(rawValue);

  if (!display) {
    return null;
  }

  return { display };
}

function buildSheetsFromXlsx(
  workbook: {
    SheetNames: string[];
    Sheets: Record<string, Record<string, unknown>>;
  },
): PreviewSheet[] {
  return workbook.SheetNames.map((sheetName, sheetIndex) => {
    const worksheet = workbook.Sheets[sheetName] ?? {};
    const ref = typeof worksheet['!ref'] === 'string' ? worksheet['!ref'] : 'A1';
    const decodeRange = (value: string) => {
      const match = value.match(/^([A-Z]+)(\d+)$/i);
      if (!match) {
        return { c: 0, r: 0 };
      }
      const [, columnLabel, rowLabel] = match;
      let column = 0;
      for (const char of columnLabel.toUpperCase()) {
        column = column * 26 + (char.charCodeAt(0) - 64);
      }
      return { c: Math.max(0, column - 1), r: Math.max(0, Number(rowLabel) - 1) };
    };
    const [startRef, endRef = startRef] = ref.split(':');
    const rangeStart = decodeRange(startRef);
    const rangeEnd = decodeRange(endRef);
    const rowCount = Math.max(1, rangeEnd.r - rangeStart.r + 1);
    const columnCount = Math.max(1, rangeEnd.c - rangeStart.c + 1);
    const cells: Record<number, Record<number, PreviewCell>> = {};

    Object.entries(worksheet).forEach(([cellAddress, value]) => {
      if (cellAddress.startsWith('!')) {
        return;
      }
      const { c, r } = decodeRange(cellAddress);
      const cell = normalizeSheetCell(value as Record<string, unknown>);
      if (!cell) {
        return;
      }
      if (!cells[r]) {
        cells[r] = {};
      }
      cells[r]![c] = cell;
    });

    const columnMeta: Record<number, { width?: number; hidden?: boolean }> = {};
    const cols = Array.isArray(worksheet['!cols']) ? (worksheet['!cols'] as Array<Record<string, unknown>>) : [];
    cols.forEach((column, index) => {
      const width =
        typeof column.wpx === 'number'
          ? Math.max(64, Math.round(column.wpx))
          : typeof column.width === 'number'
            ? Math.max(64, Math.round(column.width * 8))
            : undefined;
      columnMeta[index] = {
        ...(width != null ? { width } : {}),
        ...(column.hidden ? { hidden: true } : {}),
      };
    });

    const rowMeta: Record<number, { height?: number; hidden?: boolean }> = {};
    const rows = Array.isArray(worksheet['!rows']) ? (worksheet['!rows'] as Array<Record<string, unknown>>) : [];
    rows.forEach((row, index) => {
      const height =
        typeof row.hpx === 'number'
          ? Math.max(24, Math.round(row.hpx))
          : typeof row.hpt === 'number'
            ? Math.max(24, Math.round(row.hpt * 1.3333))
            : undefined;
      rowMeta[index] = {
        ...(height != null ? { height } : {}),
        ...(row.hidden ? { hidden: true } : {}),
      };
    });

    const merges = Array.isArray(worksheet['!merges'])
      ? (worksheet['!merges'] as Array<{ s: { c: number; r: number }; e: { c: number; r: number } }>).map((merge) => ({
          startRow: merge.s.r,
          endRow: merge.e.r,
          startColumn: merge.s.c,
          endColumn: merge.e.c,
        }))
      : [];

    return {
      id: `sheet-${sheetIndex + 1}`,
      name: sheetName,
      rowCount,
      columnCount,
      cells,
      rowMeta,
      columnMeta,
      merges,
    };
  });
}

function parseXmlDocument(xmlText: string): Document {
  const parser = new DOMParser();
  const document = parser.parseFromString(xmlText, 'application/xml');
  if (document.querySelector('parsererror')) {
    throw new Error('Excel XML 解析失败');
  }
  return document;
}

function decodeColumnLabel(label: string): number {
  let column = 0;
  for (const char of label.toUpperCase()) {
    column = column * 26 + (char.charCodeAt(0) - 64);
  }
  return Math.max(0, column - 1);
}

function decodeCellReference(reference: string): { row: number; column: number } {
  const match = reference.match(/^([A-Z]+)(\d+)$/i);
  if (!match) {
    return { row: 0, column: 0 };
  }
  return {
    column: decodeColumnLabel(match[1]!),
    row: Math.max(0, Number(match[2]) - 1),
  };
}

async function parseXlsxArchive(buffer: ArrayBuffer): Promise<PreviewSheet[]> {
  const JSZipModule = await import('jszip');
  const zip = await JSZipModule.default.loadAsync(buffer);

  const readText = async (path: string): Promise<string> => {
    const file = zip.file(path);
    if (!file) {
      throw new Error(`Excel 文件缺少 ${path}`);
    }
    return file.async('text');
  };

  const workbookDoc = parseXmlDocument(await readText('xl/workbook.xml'));
  const workbookRelsDoc = parseXmlDocument(await readText('xl/_rels/workbook.xml.rels'));

  const relTargets = new Map<string, string>();
  Array.from(workbookRelsDoc.getElementsByTagNameNS('*', 'Relationship')).forEach((relationship) => {
    const id = relationship.getAttribute('Id');
    const target = relationship.getAttribute('Target');
    if (id && target) {
      relTargets.set(id, target);
    }
  });

  const sharedStrings = zip.file('xl/sharedStrings.xml')
    ? (() => {
        const cache: string[] = [];
        return readText('xl/sharedStrings.xml').then((xml) => {
          const sharedDoc = parseXmlDocument(xml);
          Array.from(sharedDoc.getElementsByTagNameNS('*', 'si')).forEach((item) => {
            const texts = Array.from(item.getElementsByTagNameNS('*', 't')).map((node) => node.textContent ?? '');
            cache.push(texts.join(''));
          });
          return cache;
        });
      })()
    : Promise.resolve([] as string[]);

  const sharedStringValues = await sharedStrings;
  const sheetNodes = Array.from(workbookDoc.getElementsByTagNameNS('*', 'sheet'));

  const previewSheets = await Promise.all(
    sheetNodes.map(async (sheetNode, sheetIndex) => {
      const name = sheetNode.getAttribute('name') || `Sheet${sheetIndex + 1}`;
      const relId = sheetNode.getAttributeNS(
        'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
        'id',
      ) || sheetNode.getAttribute('r:id');
      const target = relId ? relTargets.get(relId) : null;
      if (!target) {
        throw new Error(`Excel 工作表 ${name} 缺少关系映射`);
      }
      const normalizedTarget = target.startsWith('xl/') ? target : `xl/${target.replace(/^\/+/, '')}`;
      const sheetPath = normalizedTarget.startsWith('xl/worksheets/')
        ? normalizedTarget
        : `xl/${target.replace(/^\/+/, '')}`;
      const sheetDoc = parseXmlDocument(await readText(sheetPath));

      const cells: Record<number, Record<number, PreviewCell>> = {};
      const rowMeta: Record<number, { height?: number; hidden?: boolean }> = {};
      const columnMeta: Record<number, { width?: number; hidden?: boolean }> = {};
      const merges: PreviewSheet['merges'] = [];
      let maxRow = 0;
      let maxColumn = 0;

      Array.from(sheetDoc.getElementsByTagNameNS('*', 'col')).forEach((columnNode) => {
        const min = Number(columnNode.getAttribute('min') ?? '1') - 1;
        const max = Number(columnNode.getAttribute('max') ?? '1') - 1;
        const widthAttr = columnNode.getAttribute('width');
        const hidden = columnNode.getAttribute('hidden') === '1';
        for (let columnIndex = min; columnIndex <= max; columnIndex += 1) {
          columnMeta[columnIndex] = {
            ...(widthAttr ? { width: Math.max(64, Math.round(Number(widthAttr) * 8)) } : {}),
            ...(hidden ? { hidden: true } : {}),
          };
          maxColumn = Math.max(maxColumn, columnIndex);
        }
      });

      Array.from(sheetDoc.getElementsByTagNameNS('*', 'row')).forEach((rowNode) => {
        const rowIndex = Math.max(0, Number(rowNode.getAttribute('r') ?? '1') - 1);
        rowMeta[rowIndex] = {
          ...(rowNode.getAttribute('ht') ? { height: Math.max(24, Math.round(Number(rowNode.getAttribute('ht')) * 1.3333)) } : {}),
          ...(rowNode.getAttribute('hidden') === '1' ? { hidden: true } : {}),
        };
        maxRow = Math.max(maxRow, rowIndex);

        Array.from(rowNode.getElementsByTagNameNS('*', 'c')).forEach((cellNode) => {
          const reference = cellNode.getAttribute('r') ?? '';
          const { row, column } = decodeCellReference(reference);
          const type = cellNode.getAttribute('t');
          const valueNode = cellNode.getElementsByTagNameNS('*', 'v')[0];
          const inlineTextNode = cellNode.getElementsByTagNameNS('*', 't')[0];
          const rawValue = valueNode?.textContent ?? '';

          let display = '';
          if (type === 's') {
            display = sharedStringValues[Number(rawValue)] ?? '';
          } else if (type === 'inlineStr') {
            display = inlineTextNode?.textContent ?? '';
          } else if (type === 'b') {
            display = rawValue === '1' ? 'TRUE' : 'FALSE';
          } else {
            display = rawValue;
          }

          if (!display) {
            return;
          }
          if (!cells[row]) {
            cells[row] = {};
          }
          cells[row]![column] = { display };
          maxRow = Math.max(maxRow, row);
          maxColumn = Math.max(maxColumn, column);
        });
      });

      Array.from(sheetDoc.getElementsByTagNameNS('*', 'mergeCell')).forEach((mergeNode) => {
        const reference = mergeNode.getAttribute('ref');
        if (!reference) {
          return;
        }
        const [startRef, endRef = startRef] = reference.split(':');
        const start = decodeCellReference(startRef);
        const end = decodeCellReference(endRef);
        merges.push({
          startRow: start.row,
          endRow: end.row,
          startColumn: start.column,
          endColumn: end.column,
        });
      });

      return {
        id: `sheet-${sheetIndex + 1}`,
        name,
        rowCount: Math.max(1, maxRow + 1),
        columnCount: Math.max(1, maxColumn + 1),
        cells,
        rowMeta,
        columnMeta,
        merges,
      };
    }),
  );

  return previewSheets;
}

async function parseWorkbookBuffer(buffer: ArrayBuffer): Promise<PreviewSheet[]> {
  const xlsxModule = await import('xlsx');
  const workbook = xlsxModule.read(buffer, {
    type: 'array',
    cellDates: true,
    cellNF: false,
    cellStyles: true,
  }) as MaybeWorkbook;

  const sheetNames = workbook.SheetNames ?? [];
  const workbookSheets = workbook.Sheets ?? {};
  const hasReadableSheets = sheetNames.some((name) => Boolean(workbookSheets[name]));

  if (sheetNames.length > 0 && hasReadableSheets) {
    return buildSheetsFromXlsx({
      SheetNames: sheetNames,
      Sheets: workbookSheets as Record<string, Record<string, unknown>>,
    });
  }

  return parseXlsxArchive(buffer);
}

export function SheetPreviewer({ item, token }: SheetPreviewerProps) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sheets, setSheets] = useState<PreviewSheet[]>([]);
  const [activeSheetId, setActiveSheetId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    setError(null);
    setLoading(true);
    setSheets([]);
    setActiveSheetId(null);

    void (async () => {
      try {
        const buffer = await fetchArrayBuffer(item.url, token);
        const nextSheets = await parseWorkbookBuffer(buffer);
        if (!cancelled) {
          setSheets(nextSheets);
          setActiveSheetId(nextSheets[0]?.id ?? null);
          setLoading(false);
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : '表格预览失败');
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [item, token]);

  const activeSheet = useMemo(
    () => sheets.find((sheet) => sheet.id === activeSheetId) ?? sheets[0] ?? null,
    [activeSheetId, sheets],
  );

  const visibleColumns = useMemo(() => {
    if (!activeSheet) {
      return [];
    }
    return Array.from({ length: activeSheet.columnCount }, (_, index) => index).filter(
      (index) => !activeSheet.columnMeta[index]?.hidden,
    );
  }, [activeSheet]);

  const visibleRows = useMemo(() => {
    if (!activeSheet) {
      return [];
    }
    return Array.from({ length: activeSheet.rowCount }, (_, index) => index).filter(
      (index) => !activeSheet.rowMeta[index]?.hidden,
    );
  }, [activeSheet]);

  const mergeMap = useMemo(() => {
    const covered = new Set<string>();
    const anchors = new Map<string, { rowSpan: number; colSpan: number }>();

    if (!activeSheet) {
      return { covered, anchors };
    }

    const visibleRowSet = new Set(visibleRows);
    const visibleColumnSet = new Set(visibleColumns);

    activeSheet.merges.forEach((merge) => {
      const rows = [];
      for (let row = merge.startRow; row <= merge.endRow; row += 1) {
        if (visibleRowSet.has(row)) {
          rows.push(row);
        }
      }
      const columns = [];
      for (let column = merge.startColumn; column <= merge.endColumn; column += 1) {
        if (visibleColumnSet.has(column)) {
          columns.push(column);
        }
      }
      if (!rows.length || !columns.length) {
        return;
      }
      anchors.set(`${rows[0]}:${columns[0]}`, {
        rowSpan: rows.length,
        colSpan: columns.length,
      });
      rows.forEach((row) => {
        columns.forEach((column) => {
          if (row === rows[0] && column === columns[0]) {
            return;
          }
          covered.add(`${row}:${column}`);
        });
      });
    });

    return { covered, anchors };
  }, [activeSheet, visibleColumns, visibleRows]);

  if (error) {
    return <div className="panel-empty">{error}</div>;
  }

  return (
    <div className="panel-sheet-shell panel-document-workspace panel-sheet-workspace">
      <div className="sheet-preview-tabs" role="tablist" aria-label="工作表">
        {sheets.map((sheet) => (
          <button
            key={sheet.id}
            type="button"
            role="tab"
            className={`sheet-preview-tab${sheet.id === activeSheet?.id ? ' is-active' : ''}`}
            aria-selected={sheet.id === activeSheet?.id}
            onClick={() => setActiveSheetId(sheet.id)}
          >
            {sheet.name}
          </button>
        ))}
      </div>

      <div className="sheet-preview-grid-shell">
        {loading ? <div className="panel-empty panel-loading-overlay">正在加载表格预览…</div> : null}
        {!loading && activeSheet ? (
          <div className="sheet-preview-grid-scroll">
            <table className="sheet-preview-grid">
              <colgroup>
                <col className="sheet-preview-row-index-col" />
                {visibleColumns.map((columnIndex) => (
                  <col
                    key={columnIndex}
                    style={{
                      width: activeSheet.columnMeta[columnIndex]?.width
                        ? `${activeSheet.columnMeta[columnIndex]!.width}px`
                        : '160px',
                    }}
                  />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th className="sheet-preview-corner" />
                  {visibleColumns.map((columnIndex) => (
                    <th key={columnIndex} className="sheet-preview-col-header">
                      {toColumnLabel(columnIndex)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((rowIndex) => (
                  <tr
                    key={rowIndex}
                    style={{
                      height: activeSheet.rowMeta[rowIndex]?.height
                        ? `${activeSheet.rowMeta[rowIndex]!.height}px`
                        : undefined,
                    }}
                  >
                    <th className="sheet-preview-row-header">{rowIndex + 1}</th>
                    {visibleColumns.map((columnIndex) => {
                      const key = `${rowIndex}:${columnIndex}`;
                      if (mergeMap.covered.has(key)) {
                        return null;
                      }
                      const merge = mergeMap.anchors.get(key);
                      const cell = activeSheet.cells[rowIndex]?.[columnIndex];
                      return (
                        <td
                          key={key}
                          className={`sheet-preview-cell${cell ? ' has-value' : ''}`}
                          rowSpan={merge?.rowSpan}
                          colSpan={merge?.colSpan}
                          title={cell?.display}
                        >
                          <span>{cell?.display ?? ''}</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  );
}
