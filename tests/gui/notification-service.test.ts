import { afterEach, describe, expect, test, vi } from 'vitest';

const notificationShow = vi.fn();
const isSupported = vi.fn(() => true);
const constructorCalls: Array<Record<string, unknown>> = [];

vi.mock('electron', () => {
  class Notification {
    static isSupported = (): boolean => isSupported();
    constructor(options: Record<string, unknown>) {
      constructorCalls.push(options);
    }
    show = notificationShow;
  }
  return { Notification };
});

const { createElectronNotificationService, noopNotificationService } =
  await import('../../src/gui/main/notification-service.js');

afterEach(() => {
  notificationShow.mockClear();
  constructorCalls.length = 0;
  isSupported.mockReturnValue(true);
});

describe('notification service', () => {
  test('noop notification service returns undefined', () => {
    expect(
      noopNotificationService.notify({ level: 'info', title: 't', message: 'm' }),
    ).toBeUndefined();
  });

  test('electron notification shows a normal-urgency toast for info events', () => {
    const service = createElectronNotificationService();
    service.notify({ level: 'info', title: 'Done', message: 'All good' });

    expect(notificationShow).toHaveBeenCalledTimes(1);
    expect(constructorCalls[0]).toEqual({
      title: 'Done',
      body: 'All good',
      urgency: 'normal',
    });
  });

  test('electron notification escalates error events to critical urgency', () => {
    const service = createElectronNotificationService();
    service.notify({ level: 'error', title: 'Boom', message: 'Failure' });

    expect(constructorCalls[0]?.urgency).toBe('critical');
  });

  test('electron notification stays silent when notifications are unsupported', () => {
    isSupported.mockReturnValue(false);
    const service = createElectronNotificationService();
    service.notify({ level: 'warn', title: 'Heads up', message: 'Careful' });

    expect(notificationShow).not.toHaveBeenCalled();
    expect(constructorCalls).toHaveLength(0);
  });
});
