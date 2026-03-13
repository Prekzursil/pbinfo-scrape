import { Notification } from 'electron';

export interface DesktopNotification {
  level: 'info' | 'warn' | 'error';
  title: string;
  message: string;
}

export interface NotificationService {
  notify(notification: DesktopNotification): void | Promise<void>;
}

export const noopNotificationService: NotificationService = {
  notify() {
    return undefined;
  },
};

export function createElectronNotificationService(): NotificationService {
  return {
    notify(notification) {
      if (!Notification.isSupported()) {
        return;
      }

      new Notification({
        title: notification.title,
        body: notification.message,
        urgency: notification.level === 'error' ? 'critical' : 'normal',
      }).show();
    },
  };
}
