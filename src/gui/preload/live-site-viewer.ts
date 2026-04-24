// Intentionally empty preload. The child window for the live-site viewer runs
// with contextIsolation + sandbox and exposes NO IPC bridge to the rendered
// page. If a future feature needs IPC here, add it explicitly — don't widen
// this surface implicitly.
export {};
