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

export interface ClientOptions {
  url?: string;
  verifyCert?: boolean;
  version?: number;
  timeout?: number;
  headers?: HttpHeaders;
  retries?: number;
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

  constructor(
    clientId?: string,
    clientKey?: string,
    options: ClientOptions = {},
  ) {
    this.clientId = typeof clientId === 'string' ? clientId : '';
    this.clientKey = typeof clientKey === 'string' ? clientKey : '';
    this.options = {};
    this.httpClient = null;

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
    const { url, timeout, verifyCert, headers } = this.options;

    const authToken = Buffer.from(
      `${this.clientId}:${this.clientKey}`,
      'utf8',
    ).toString('base64');

    const jar = new CookieJar();

    this.httpClient = axios.create({
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
      }),
      httpsAgent: new HttpsCookieAgent({
        cookies: { jar },
        rejectUnauthorized: Boolean(verifyCert),
      }),
      ...(timeout ? { timeout } : undefined),
    });
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

        try {
          const response = await this.httpClient.request<T>(requestParams);
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
        }
      });
    });
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
