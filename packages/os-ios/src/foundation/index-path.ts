/**
 * IndexPath as UIKit's lists use it: a section and a row (`item` for
 * collection views).
 */
export class IndexPath {
  constructor(readonly row: number, readonly section: number) {}

  get item(): number {
    return this.row;
  }

  isEqual(other: IndexPath | null): boolean {
    return !!other && other.row === this.row && other.section === this.section;
  }

  toString(): string {
    return `[${this.section}, ${this.row}]`;
  }
}
