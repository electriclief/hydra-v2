/**
 * Ambient declaration for the OPTIONAL 'electron' import.
 *
 * This module either runs inside a real Electron app (where 'electron' resolves at
 * runtime, main process) or receives an injected ElectronSurface from its host.
 * Type-checking the dynamic import as `any` keeps plain-node builds green; the cast
 * at the import site names the exact surface the module touches.
 */
declare module 'electron';
