// The flight-test report writer needs only this from Node (the project has no @types/node).
declare module 'node:fs' {
  export function writeFileSync(path: URL | string, data: string): void;
}
