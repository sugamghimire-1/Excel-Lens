/** Imperative handle to the mounted grid, so state code never imports UI modules. */
export interface GridApi {
  focus(): void;
  /** Scrolls the minimum distance needed to show a cell. */
  reveal(r: number, c: number): void;
  /** Cell rectangle in page coordinates, or null when it is off screen. */
  cellRect(r: number, c: number): DOMRect | null;
  /** Rows in one screenful, for Page Up and Page Down. */
  pageRows(): number;
  pageCols(): number;
  /** Unzoomed sheet position of the centre of the viewport. */
  center(): { x: number; y: number };
  viewportSize(): { w: number; h: number };
}

const noop: GridApi = {
  focus() {},
  reveal() {},
  cellRect: () => null,
  pageRows: () => 20,
  pageCols: () => 8,
  center: () => ({ x: 300, y: 200 }),
  viewportSize: () => ({ w: 1000, h: 600 }),
};

let current: GridApi = noop;

export function mountGridApi(api: GridApi): () => void {
  current = api;
  return () => {
    if (current === api) current = noop;
  };
}

export const gridApi: GridApi = {
  focus: () => current.focus(),
  reveal: (r, c) => current.reveal(r, c),
  cellRect: (r, c) => current.cellRect(r, c),
  pageRows: () => current.pageRows(),
  pageCols: () => current.pageCols(),
  center: () => current.center(),
  viewportSize: () => current.viewportSize(),
};
