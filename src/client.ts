import * as axios from 'axios';
import * as retry from 'retry';
import { CookieJar } from 'tough-cookie';
import { HttpCookieAgent, HttpsCookieAgent } from 'http-cookie-agent/http';

export const enum HttpMethod {
  get = 'get',
  post = 'post',
  put = 'put',
  delete = 'delete',
}

export interface HttpHeaders {
  [header: string]: axios.AxiosHeaderValue;
}

export interface HttpClientWrapper {
  client: axios.AxiosInstance;
  createdAt: number;
  activeRequests: number;
  totalRequests: number;
}

export interface ClientOptions {
  url?: string;
  verifyCert?: boolean;
  version?: number;
  timeout?: number;
  headers?: HttpHeaders;
  retries?: number;
  maxSockets?: number;
  recycleAfterRequests?: number;
  recycleAfterMs?: number;
  onClientRecycle?: (stats: {
    createdAt: number;
    activeRequests: number;
    totalRequests: number;
    ageMs: number;
    newClientCreatedAt: number;
  }) => void;
}

const MODULE_VERSION: string = (({ name, version }) => {
  return `${name}@${version}`;
})(require('../package.json')); // eslint-disable-line @typescript-eslint/no-var-requires

const USER_APP_VERSION: string | undefined =
  process.env.npm_package_name && process.env.npm_package_version
    ? `${process.env.npm_package_name}@${process.env.npm_package_version}`
    : undefined;

const DEFAULT_OPTIONS: Readonly<ClientOptions> = Object.freeze({
  url: 'https://api.swell.store',
  verifyCert: true,
  version: 1,
  headers: {},
  retries: 0, // 0 => no retries
  maxSockets: 100,
  recycleAfterRequests: 1000,
  recycleAfterMs: 15000, // 15 seconds
});

class ApiError extends Error {
  message: string;
  code?: string;
  status?: number;
  headers: HttpHeaders;

  constructor(
    message: string,
    code?: string,
    status?: number,
    headers: HttpHeaders = {},
  ) {
    super();

    this.message = message;
    this.code = code;
    this.status = status;
    this.headers = headers;
  }
}

// We should retry request only in case of timeout or disconnect
const RETRY_CODES = new Set(['ECONNABORTED', 'ECONNREFUSED']);

/**
 * Swell API Client.
 */
export class Client {
  clientId: string;
  clientKey: string;
  options: ClientOptions;
  httpClient: axios.AxiosInstance | null;
  private _activeClient: HttpClientWrapper | null;
  private _oldClients: Map<string, HttpClientWrapper>;
  private _clientCounter: number;

  constructor(
    clientId?: string,
    clientKey?: string,
    options: ClientOptions = {},
  ) {
    this.clientId = typeof clientId === 'string' ? clientId : '';
    this.clientKey = typeof clientKey === 'string' ? clientKey : '';
    this.options = {};
    this.httpClient = null;
    this._activeClient = null;
    this._oldClients = new Map();
    this._clientCounter = 0;

    if (clientId) {
      this.init(clientId, clientKey, options);
    }
  }

  /**
   * Convenience method to create a new client instance from a singleton instance.
   */
  createClient(
    clientId: string,
    clientKey: string,
    options: ClientOptions = {},
  ): Client {
    return new Client(clientId, clientKey, options);
  }

  init(clientId?: string, clientKey?: string, options?: ClientOptions): void {
    if (!clientId) {
      throw new Error("Swell store 'id' is required to connect");
    }

    if (!clientKey) {
      throw new Error("Swell store 'key' is required to connect");
    }

    this.clientId = clientId;
    this.clientKey = clientKey;

    this.options = { ...DEFAULT_OPTIONS, ...options };

    this._initHttpClient();
  }

  _initHttpClient(): void {
    const { url, timeout, verifyCert, headers, maxSockets } = this.options;

    const authToken = Buffer.from(
      `${this.clientId}:${this.clientKey}`,
      'utf8',
    ).toString('base64');

    const jar = new CookieJar();

    const newClient = axios.create({
      baseURL: url,
      headers: {
        common: {
          ...headers,
          'Content-Type': 'application/json',
          'User-Agent': MODULE_VERSION,
          'X-User-Application': USER_APP_VERSION,
          Authorization: `Basic ${authToken}`,
        },
      },
      httpAgent: new HttpCookieAgent({
        cookies: { jar },
        keepAlive: true,
        maxSockets: maxSockets || 100,
        keepAliveMsecs: 1000,
      }),
      httpsAgent: new HttpsCookieAgent({
        cookies: { jar },
        rejectUnauthorized: Boolean(verifyCert),
        keepAlive: true,
        maxSockets: maxSockets || 100,
        keepAliveMsecs: 1000,
      }),
      ...(timeout ? { timeout } : undefined),
    });

    this.httpClient = newClient;
    this._activeClient = {
      client: newClient,
      createdAt: Date.now(),
      activeRequests: 0,
      totalRequests: 0,
    };
  }

  private _shouldRecycleClient(): boolean {
    if (!this._activeClient) return false;

    const { recycleAfterRequests, recycleAfterMs } = this.options;
    const now = Date.now();
    const ageMs = now - this._activeClient.createdAt;

    return (
      this._activeClient.totalRequests >= (recycleAfterRequests || 1000) &&
      ageMs >= (recycleAfterMs || 300000)
    );
  }

  private _recycleHttpClient(): void {
    if (!this._activeClient) return;

    const oldClientStats = {
      createdAt: this._activeClient.createdAt,
      activeRequests: this._activeClient.activeRequests,
      totalRequests: this._activeClient.totalRequests,
      ageMs: Date.now() - this._activeClient.createdAt,
    };

    // Move current client to old clients map
    const clientId = `client_${++this._clientCounter}`;
    this._oldClients.set(clientId, this._activeClient);

    // Create new client
    this._initHttpClient();

    // Call the callback if provided
    if (this.options.onClientRecycle) {
      this.options.onClientRecycle({
        ...oldClientStats,
        newClientCreatedAt: this._activeClient!.createdAt,
      });
    }

    // Schedule cleanup of old client when no active requests
    this._scheduleOldClientCleanup(clientId);
  }

  private _scheduleOldClientCleanup(clientId: string): void {
    const checkInterval = setInterval(() => {
      const oldClient = this._oldClients.get(clientId);
      if (!oldClient) {
        clearInterval(checkInterval);
        return;
      }

      if (oldClient.activeRequests === 0) {
        // Destroy the HTTP agents to free resources
        if (oldClient.client.defaults.httpAgent) {
          (oldClient.client.defaults.httpAgent as any).destroy?.();
        }
        if (oldClient.client.defaults.httpsAgent) {
          (oldClient.client.defaults.httpsAgent as any).destroy?.();
        }

        this._oldClients.delete(clientId);
        clearInterval(checkInterval);
      }
    }, 1000); // Check every second
  }

  private _getClientForRequest(): HttpClientWrapper {
    // Check if we need to recycle the current client
    if (this._shouldRecycleClient()) {
      this._recycleHttpClient();
    }

    return this._activeClient!;
  }

  get<T>(url: string, data?: unknown, headers?: HttpHeaders): Promise<T> {
    return this.request(HttpMethod.get, url, data, headers);
  }

  post<T>(url: string, data: unknown, headers?: HttpHeaders): Promise<T> {
    return this.request(HttpMethod.post, url, data, headers);
  }

  put<T>(url: string, data: unknown, headers?: HttpHeaders): Promise<T> {
    return this.request(HttpMethod.put, url, data, headers);
  }

  delete<T>(url: string, data?: unknown, headers?: HttpHeaders): Promise<T> {
    return this.request(HttpMethod.delete, url, data, headers);
  }

  async request<T>(
    method: HttpMethod,
    url: string,
    data?: unknown,
    headers?: HttpHeaders,
  ): Promise<T> {
    // Prepare url and data for request
    const requestParams = transformRequest(method, url, data, headers);

    return new Promise((resolve, reject) => {
      const { retries } = this.options;

      const operation = retry.operation({
        retries,
        minTimeout: 20,
        maxTimeout: 100,
        factor: 1,
        randomize: false,
      });

      operation.attempt(async () => {
        if (this.httpClient === null) {
          return reject(new Error('Swell API client not initialized'));
        }

        const clientWrapper = this._getClientForRequest();

        // Increment counters
        clientWrapper.activeRequests++;
        clientWrapper.totalRequests++;

        try {
          const response = await clientWrapper.client.request<T>(requestParams);
          resolve(transformResponse(response).data);
        } catch (error) {
          // Attempt retry if we encounter a timeout or connection error
          const code = axios.isAxiosError(error) ? error?.code : null;

          if (
            code &&
            RETRY_CODES.has(code) &&
            operation.retry(error as Error)
          ) {
            return;
          }
          reject(transformError(error));
        } finally {
          // Decrement active request counter
          clientWrapper.activeRequests--;
        }
      });
    });
  }

  /**
   * Get statistics about HTTP client usage
   */
  getClientStats() {
    return {
      activeClient: this._activeClient
        ? {
            createdAt: this._activeClient.createdAt,
            activeRequests: this._activeClient.activeRequests,
            totalRequests: this._activeClient.totalRequests,
            ageMs: Date.now() - this._activeClient.createdAt,
          }
        : null,
      oldClientsCount: this._oldClients.size,
      oldClients: Array.from(this._oldClients.entries()).map(
        ([id, client]) => ({
          id,
          createdAt: client.createdAt,
          activeRequests: client.activeRequests,
          totalRequests: client.totalRequests,
          ageMs: Date.now() - client.createdAt,
        }),
      ),
    };
  }
}

/**
 * Transforms the request.
 *
 * @param method The HTTP method
 * @param url    The request URL
 * @param data   The request data
 * @return a normalized request object
 */
function transformRequest(
  method: HttpMethod,
  url: string,
  data: unknown,
  headers?: HttpHeaders,
): axios.AxiosRequestConfig {
  return {
    method,
    url: typeof url?.toString === 'function' ? url.toString() : '',
    data: data !== undefined ? data : null,
    headers,
  };
}

interface TransformedResponse<T> {
  data: T;
  headers: HttpHeaders;
  status: number;
}

/**
 * Transforms the response.
 *
 * @param response The response object
 * @return a normalized response object
 */
function transformResponse<T>(
  response: axios.AxiosResponse<T>,
): TransformedResponse<T> {
  const { data, headers, status } = response;
  return {
    data,
    headers: normalizeHeaders(headers),
    status,
  };
}

function isError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}

/**
 * Transforms the error response.
 *
 * @param error The Error object
 * @return {ApiError}
 */
function transformError(error: unknown): ApiError {
  let code,
    message = '',
    status,
    headers;

  if (axios.isAxiosError(error)) {
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      const { data, statusText } = error.response;
      code = statusText;
      message = formatMessage(data);
      status = error.response.status;
      headers = normalizeHeaders(error.response.headers);
    } else if (error.request) {
      // The request was made but no response was received
      code = 'NO_RESPONSE';
      message = 'No response from server';
    } else {
      // Something happened in setting up the request that triggered an Error
      // The request was made but no response was received
      code = error.code;
      message = error.message;
    }
  } else if (isError(error)) {
    code = error.code;
    message = error.message;
  }

  return new ApiError(
    message,
    typeof code === 'string' ? code.toUpperCase().replace(/ /g, '_') : 'ERROR',
    status,
    headers,
  );
}

function normalizeHeaders(
  headers: axios.AxiosResponse['headers'],
): HttpHeaders {
  // so that headers are not returned as AxiosHeaders
  return Object.fromEntries(Object.entries(headers || {}));
}

function formatMessage(message: unknown): string {
  // get rid of trailing newlines
  return typeof message === 'string' ? message.trim() : String(message);
}
