import { beforeEach, describe, expect, test, vi } from 'vitest';

import {
  createElectronNotificationService,
  noopNotificationService,
} from '../../src/gui/main/notification-service.js';

const mocks = vi.hoisted(() => ({
  isSupported: vi.fn(() => true),
  show: vi.fn(),
}));

vi.mock('electron', () => ({
  Notification: class {
    public readonly opts: { urgency?: string };

    static isSupported(): boolean {
      return mocks.isSupported();
    }

    constructor(opts: { urgency?: string }) {
      this.opts = opts;
    }

    show(): void {
      mocks.show(this.opts);
    }
  },
}));

beforeEach(() => {
  mocks.isSupported.mockReset();
  mocks.isSupported.mockReturnValue(true);
  mocks.show.mockReset();
});

describe('notification service', () => {
  test('noop service returns undefined', () => {
    expect(noopNotificationService.notify({ level: 'info', title: 't', message: 'm' })).toBeUndefined();
  });

  test('does nothing when notifications are unsupported', () => {
    mocks.isSupported.mockReturnValue(false);
    createElectronNotificationService().notify({ level: 'info', title: 't', message: 'm' });
    expect(mocks.show).not.toHaveBeenCalled();
  });

  test('shows a critical notification for errors and a normal one otherwise', () => {
    const service = createElectronNotificationService();
    service.notify({ level: 'error', title: 'boom', message: 'failed' });
    service.notify({ level: 'info', title: 'ok', message: 'done' });
    expect(mocks.show).toHaveBeenCalledTimes(2);
    expect(mocks.show).toHaveBeenNthCalledWith(1, expect.objectContaining({ urgency: 'critical' }));
    expect(mocks.show).toHaveBeenNthCalledWith(2, expect.objectContaining({ urgency: 'normal' }));
  });
});
