export type AuthAwareReauth = () => Promise<boolean>;

export interface AuthAwareFetchOptions {
  baseFetch: typeof fetch;
  /** Called when the wrapper detects a logged-out response. Returns true on success. */
  reauth: AuthAwareReauth;
  /**
   * Custom detector. Default returns true when the final response URL contains
   * common pbinfo login markers. If `readBody` is enabled, bodyText is passed
   * through (may be null when the body could not be safely read).
   */
  detectLoggedOut?: (input: {
    response: Response;
    finalUrl: string;
    bodyText: string | null;
  }) => boolean;
  /**
   * When true, the detector receives the cloned response body so it can look
   * for markers like `user_autentificat = {"id":0}` or `<form id="form-login">`.
   * Default: false — detection is URL-only to avoid consuming bodies twice.
   */
  readBody?: boolean;
}

export interface AuthAwareFetch {
  fetch: typeof fetch;
  /** Number of reauth attempts observed since construction. */
  getReauthCount: () => number;
}

const DEFAULT_LOGIN_URL_MARKERS = [
  'pagina=login',
  '/login.php',
  '/ajx-module/php-login.php',
];

const DEFAULT_LOGIN_BODY_MARKERS = [
  'id="form-login"',
  'user_autentificat = {"id":0',
  'user_autentificat={"id":0',
];

/**
 * Wraps a base fetch so that when a response indicates a logged-out session
 * (redirected to the login URL or body contains login markers), the wrapper
 * invokes `reauth` once, then retries the original request. Only one reauth
 * attempt is in flight at a time — parallel callers share the same promise.
 */
export function createAuthAwareFetch(options: AuthAwareFetchOptions): AuthAwareFetch {
  const detect =
    options.detectLoggedOut
    ?? ((input) => defaultDetectLoggedOut(input));
  const readBody = options.readBody ?? false;
  let reauthCount = 0;
  let inFlightReauth: Promise<boolean> | null = null;

  const wrapped: typeof fetch = async (input, init) => {
    const firstResponse = await options.baseFetch(input, init);
    const firstBody = readBody ? await safeReadBody(firstResponse) : null;
    const firstLoggedOut = detect({
      response: firstResponse,
      finalUrl: firstResponse.url || inputToUrlString(input),
      bodyText: firstBody,
    });
    if (!firstLoggedOut) {
      return firstResponse;
    }

    if (!inFlightReauth) {
      reauthCount += 1;
      inFlightReauth = options.reauth().finally(() => {
        inFlightReauth = null;
      });
    }
    const reauthOk = await inFlightReauth;
    if (!reauthOk) {
      return firstResponse;
    }

    return options.baseFetch(input, init);
  };

  return {
    fetch: wrapped,
    getReauthCount: () => reauthCount,
  };
}

function defaultDetectLoggedOut(input: {
  response: Response;
  finalUrl: string;
  bodyText: string | null;
}): boolean {
  const url = input.finalUrl.toLowerCase();
  for (const marker of DEFAULT_LOGIN_URL_MARKERS) {
    if (url.includes(marker)) {
      return true;
    }
  }
  if (input.bodyText) {
    const body = input.bodyText;
    for (const marker of DEFAULT_LOGIN_BODY_MARKERS) {
      if (body.includes(marker)) {
        return true;
      }
    }
  }
  return false;
}

async function safeReadBody(response: Response): Promise<string | null> {
  try {
    return await response.clone().text();
  } catch {
    return null;
  }
}

function inputToUrlString(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}
