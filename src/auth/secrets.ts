import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { armor, Decrypter, Encrypter, generateIdentity, identityToRecipient } from 'age-encryption';

import type { LoadedLocalConfig } from '../config/local-config.js';

export interface SecretBundlePayload {
  exportedAt: string;
  localConfig?: unknown;
  sessionCookies?: unknown;
}

export interface BootstrapSecretBundleResult {
  bundlePath: string;
  recipientPath: string;
  identityPath: string;
  recipient: string;
  createdIdentity: boolean;
}

export async function bootstrapSecretBundle(
  config: LoadedLocalConfig,
  now = new Date(),
): Promise<BootstrapSecretBundleResult> {
  const { recipient, createdIdentity } = await ensureIdentityMaterial(config);
  const payload: SecretBundlePayload = {
    exportedAt: now.toISOString(),
    localConfig: readJsonIfExists(config.paths.localRoot, 'pbinfo.local.json'),
    sessionCookies: existsSync(config.auth.sessionCookiesPath)
      ? JSON.parse(readFileSync(config.auth.sessionCookiesPath, 'utf8'))
      : undefined,
  };

  const encrypter = new Encrypter();
  encrypter.addRecipient(recipient);
  const ciphertext = await encrypter.encrypt(JSON.stringify(payload, null, 2));
  const armored = armor.encode(ciphertext);

  mkdirSync(dirname(config.secrets.recipientPath), { recursive: true });
  writeFileSync(config.secrets.recipientPath, `${recipient}\n`, 'utf8');
  writeFileSync(config.secrets.bundlePath, armored, 'utf8');

  return {
    bundlePath: config.secrets.bundlePath,
    recipientPath: config.secrets.recipientPath,
    identityPath: config.secrets.identityPath,
    recipient,
    createdIdentity,
  };
}

export async function decryptSecretBundle(
  config: LoadedLocalConfig,
): Promise<SecretBundlePayload> {
  const identity = readFileSync(config.secrets.identityPath, 'utf8').trim();
  const armoredCiphertext = readFileSync(config.secrets.bundlePath, 'utf8');
  const decrypter = new Decrypter();
  decrypter.addIdentity(identity);
  const plaintext = await decrypter.decrypt(armor.decode(armoredCiphertext), 'text');
  return JSON.parse(plaintext) as SecretBundlePayload;
}

export async function restoreSecretBundle(
  config: LoadedLocalConfig,
): Promise<SecretBundlePayload> {
  const payload = await decryptSecretBundle(config);
  mkdirSync(config.paths.localRoot, { recursive: true });

  if (payload.localConfig !== undefined) {
    writeFileSync(
      `${config.paths.localRoot}/pbinfo.local.json`,
      JSON.stringify(payload.localConfig, null, 2),
      'utf8',
    );
  }

  if (payload.sessionCookies !== undefined) {
    writeFileSync(
      config.auth.sessionCookiesPath,
      JSON.stringify(payload.sessionCookies, null, 2),
      'utf8',
    );
  }

  return payload;
}

async function ensureIdentityMaterial(
  config: LoadedLocalConfig,
): Promise<{ identity: string; recipient: string; createdIdentity: boolean }> {
  let identity = config.secrets.identityPath && existsSync(config.secrets.identityPath)
    ? readFileSync(config.secrets.identityPath, 'utf8').trim()
    : '';
  let createdIdentity = false;

  if (!identity) {
    identity = await generateIdentity();
    mkdirSync(dirname(config.secrets.identityPath), { recursive: true });
    writeFileSync(config.secrets.identityPath, `${identity}\n`, 'utf8');
    createdIdentity = true;
  }

  const recipient =
    config.secrets.recipient
    ?? (existsSync(config.secrets.recipientPath)
      ? readFileSync(config.secrets.recipientPath, 'utf8').trim()
      : await identityToRecipient(identity));

  return {
    identity,
    recipient,
    createdIdentity,
  };
}

function readJsonIfExists(root: string, fileName: string): unknown | undefined {
  const path = `${root}/${fileName}`;
  if (!existsSync(path)) {
    return undefined;
  }

  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}
