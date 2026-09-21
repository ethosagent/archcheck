declare function registerRoute(spec: {
  path: string;
  permission?: string;
  operationId?: string;
}): void;

// LEGAL: declares both.
registerRoute({ path: '/events', permission: 'events.read', operationId: 'listEvents' });

// THE PLANTED VIOLATION: no permission. A global chain knows who the caller is; only the
// endpoint knows what is being asked.
registerRoute({ path: '/events/secret', operationId: 'readSecret' });

// THE PLANTED VIOLATION: a permission outside the allowed set.
registerRoute({ path: '/events/admin', permission: 'god.mode', operationId: 'admin' });
