export type PermissionType = 'write_file' | 'run_command';

export interface PendingPermission {
  type: PermissionType;
  path?: string;
  command?: string;
  preview?: string;
}

export type PermissionResult = 'allow' | 'deny' | 'allow_all';

let resolver: ((result: PermissionResult) => void) | null = null;
let pendingAction: PendingPermission | null = null;
let allowAllSession = false;
let allowedPaths = new Set<string>();
let allowedCommands = new Set<string>();

const DANGEROUS_PATTERNS = [
  /^rm\s+-rf\s+\//,
  /^sudo\s+/,
  /^dd\s+/,
  /^mkfs\s+/,
  /^fdisk\s+/,
];

export function requestPermission(
  type: PermissionType,
  data: { path?: string; command?: string; preview?: string }
): Promise<PermissionResult> | PermissionResult {
  if (type === 'write_file' && allowAllSession) {
    if (data.path) allowedPaths.add(data.path);
    return 'allow_all';
  }

  if (type === 'run_command' && allowAllSession) {
    if (data.command) allowedCommands.add(data.command);
    return 'allow_all';
  }

  if (type === 'write_file' && data.path && allowedPaths.has(data.path)) {
    return 'allow';
  }

  if (type === 'run_command' && data.command && allowedCommands.has(data.command)) {
    return 'allow';
  }

  if (type === 'run_command' && data.command) {
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(data.command)) {
        pendingAction = { type, ...data };
        return new Promise<PermissionResult>((r) => {
          resolver = r;
        });
      }
    }
  }

  pendingAction = { type, ...data };
  return new Promise<PermissionResult>((r) => {
    resolver = r;
  });
}

export function resolvePermission(result: PermissionResult): void {
  if (!resolver || !pendingAction) return;

  if (result === 'allow_all') {
    allowAllSession = true;
  } else if (result === 'allow') {
    if (pendingAction.type === 'write_file' && pendingAction.path) {
      allowedPaths.add(pendingAction.path);
    }
    if (pendingAction.type === 'run_command' && pendingAction.command) {
      allowedCommands.add(pendingAction.command);
    }
  }

  resolver(result);
  resolver = null;
  pendingAction = null;
}

export function getPendingPermission(): PendingPermission | null {
  return pendingAction;
}

export function isResolving(): boolean {
  return resolver !== null;
}