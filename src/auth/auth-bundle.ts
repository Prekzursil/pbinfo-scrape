import { loadLocalConfig } from '../config/local-config.js';
import { bootstrapSecretBundle, restoreSecretBundle } from './secrets.js';

export async function createEncryptedAuthBundle(options: {
  workspaceRoot: string;
  recipient?: string;
}) {
  const config = loadLocalConfig(options.workspaceRoot);
  return bootstrapSecretBundle(
    options.recipient
      ? {
          ...config,
          secrets: {
            ...config.secrets,
            recipient: options.recipient,
          },
        }
      : config,
  );
}

export async function restoreEncryptedAuthBundle(options: {
  workspaceRoot: string;
  sourcePath: string;
  identityPath?: string;
}) {
  const config = loadLocalConfig(options.workspaceRoot);
  await restoreSecretBundle({
    ...config,
    secrets: {
      ...config.secrets,
      bundlePath: options.sourcePath || config.secrets.bundlePath,
      identityPath: options.identityPath || config.secrets.identityPath,
    },
  });
  return {
    restored: true,
  };
}
