/**
 * @module sqlite
 * @description Minimal declarations for Node's built-in `node:sqlite` (22.5+), which ships without
 *              types in @types/node 22.0. Only the surface this module uses is declared.
 */

declare module 'node:sqlite' {
  export interface StatementSync {
    all(...params: unknown[]): Record<string, unknown>[];
    get(...params: unknown[]): Record<string, unknown> | undefined;
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  }
  export interface DatabaseSyncOptions {
    readOnly?: boolean;
    enableForeignKeyConstraints?: boolean;
    timeout?: number;
  }
  export class DatabaseSync {
    constructor(path: string, options?: DatabaseSyncOptions);
    prepare(sql: string): StatementSync;
    exec(sql: string): void;
    close(): void;
  }
}
