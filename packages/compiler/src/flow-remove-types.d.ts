declare module 'flow-remove-types' {
  export default function flowRemoveTypes(source: string, options?: { all?: boolean; pretty?: boolean }): { toString(): string };
}
