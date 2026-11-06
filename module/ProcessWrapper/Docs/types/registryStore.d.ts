/**
 * @module registryStore
 * @description The saved-commands registry: data.yaml is the ground truth, with a small
 *              YAML codec and the add/update/remove operations on top of it.
 * @intent A wrapper that only accepts commands typed at it forgets everything when it
 *         closes. This module keeps the operator's named commands (a probe, a server, a
 *         build) in a plain readable `data.yaml` next to the code — one file, no database,
 *         round-trip tested — so any surface (API, CLI, a future Hydra module) can list
 *         what this box can launch and start it by name.
 */
import type { ProcessSpec } from './processWrapper.js';
/** One saved command — a name plus everything needed to launch it. */
export interface CommandDefinition {
    name: string;
    command: string;
    args: string[];
    cwd: string;
    env: Record<string, string>;
    shell: boolean;
    description: string;
    tag: string | null;
    createdAt: string;
    updatedAt: string;
}
/** The whole persisted state. */
export interface RegistryState {
    version: number;
    lastUpdated: string;
    commands: CommandDefinition[];
}
export interface RegistryLoadResult {
    state: RegistryState;
    file: string;
    /** Set when the file existed but could not be read/parsed — defaults were used. */
    error: string | null;
}
export type CommandPatch = Partial<Omit<CommandDefinition, 'name' | 'createdAt'>>;
/** A brand-new empty registry. */
export declare function defaultRegistry(): RegistryState;
/** RegistryState → YAML text (the shape this module's parser reads back). */
export declare function stateToYaml(state: RegistryState): string;
/** YAML text → RegistryState. Unknown shapes fall back to sane defaults. */
export declare function yamlToState(yaml: string, fallbackName?: string): RegistryState;
/** Read the registry. A missing or broken file yields defaults; a broken one says so. */
export declare function loadRegistry(file: string): RegistryLoadResult;
/** Write the registry, refreshing lastUpdated. Returns the state that was written. */
export declare function saveRegistry(file: string, state: RegistryState): RegistryState;
/** Add a command. Throws when the name is taken or empty. */
export declare function addCommand(state: RegistryState, def: Partial<CommandDefinition> & {
    name: string;
}): CommandDefinition;
/** Change one saved command. Throws when it does not exist. */
export declare function updateCommand(state: RegistryState, name: string, patch: CommandPatch): CommandDefinition;
/** Drop one saved command. Returns whether anything was removed. */
export declare function removeCommand(state: RegistryState, name: string): boolean;
/** Look one up by name. */
export declare function getCommand(state: RegistryState, name: string): CommandDefinition | null;
/** Turn a saved command into a launch spec (never mutating the saved definition). */
export declare function toSpec(def: CommandDefinition, overrides?: Partial<ProcessSpec>): ProcessSpec;
export declare function runTests(): Promise<void>;
