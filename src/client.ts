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

export interface ConnectionPoolOptions {
  keepAlive?: boolean;
  maxSockets?: number;
  keepAliveMsecs?: number;
}

export interface ClientOptions {
  url?: string;
  verifyCert?: boolean;
  version?: number;
  timeout?: number;
  headers?: HttpHeaders;
  retries?: number;
  connectionPool?: ConnectionPoolOptions;
}

export interface RotationOptions {
  percentage?: number;
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
  private httpAgent: any;
  private httpsAgent: any;

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
    const { url, timeout, verifyCert, headers, connectionPool } = this.options;

    const authToken = Buffer.from(
      `${this.clientId}:${this.clientKey}`,
      'utf8',
    ).toString('base64');

    const jar = new CookieJar();

    // Default connection pool settings
    const poolConfig = {
      keepAlive: connectionPool?.keepAlive ?? true,
      maxSockets: connectionPool?.maxSockets ?? 100,
      keepAliveMsecs: connectionPool?.keepAliveMsecs ?? 1000
    };

    this.httpAgent = new HttpCookieAgent({
      cookies: { jar },
      ...poolConfig
    });

    this.httpsAgent = new HttpsCookieAgent({
      cookies: { jar },
      rejectUnauthorized: Boolean(verifyCert),
      ...poolConfig
    });

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
      httpAgent: this.httpAgent,
      httpsAgent: this.httpsAgent,
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

  /**
   * Rotate a percentage of active connections by removing them from the reuse pool.
   * Sockets will naturally close after keepAliveMsecs of idle time.
   * Returns the number of sockets removed from pools.
   */
  rotateConnections(options?: RotationOptions): number {
    const percentage = Math.max(0, Math.min(1, options?.percentage ?? 0.2));
    let totalRotated = 0;

    [this.httpAgent, this.httpsAgent].forEach(agent => {
      if (!agent || !agent.sockets) return;
      
      // Check if agent has proper keepAlive configuration
      const keepAlive = agent.keepAlive ?? false;
      const keepAliveMsecs = agent.keepAliveMsecs;
      
      if (!keepAlive || !keepAliveMsecs || keepAliveMsecs > 60000) {
        // No rotation without proper timeout configuration
        return;
      }
      
      totalRotated += this._rotateAgentConnections(agent, percentage);
    });

    return totalRotated;
  }

  private _rotateAgentConnections(agent: any, percentage: number): number {
    let rotated = 0;
    
    try {
      // Check both sockets (active) and freeSockets (idle) pools
      const poolTypes = ['sockets', 'freeSockets'];
      
      for (const poolType of poolTypes) {
        const pools = agent[poolType];
        if (!pools) continue;
        
        for (const hostKey in pools) {
          const pool = pools[hostKey];
          
          if (!Array.isArray(pool) || pool.length === 0) continue;
          
          const toRotate = Math.ceil(pool.length * percentage);
          const indices = this._selectRandomIndices(pool.length, toRotate);
          
          // Remove sockets from pool (from end to avoid index shifting)
          indices.sort((a, b) => b - a).forEach(index => {
            const socket = pool.splice(index, 1)[0];
            if (socket && !socket.destroyed) {
              rotated++;
            }
          });
        }
      }
    } catch (error) {
      // Silently handle errors - partial rotation is better than none
    }
    
    return rotated;
  }

  private _selectRandomIndices(poolSize: number, count: number): number[] {
    const indices: number[] = [];
    const available = Array.from({ length: poolSize }, (_, i) => i);
    
    for (let i = 0; i < count && available.length > 0; i++) {
      const randomIndex = Math.floor(Math.random() * available.length);
      indices.push(available[randomIndex]);
      available[randomIndex] = available[available.length - 1];
      available.pop();
    }
    
    return indices;
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
