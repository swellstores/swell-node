# Swell Node Client - AI Development Guide

## Project Overview
A TypeScript HTTP client library for the [Swell ecommerce API](https://developers.swell.is/backend-api). Provides both singleton and multi-client patterns with advanced features like HTTP connection pooling, request recycling, and automatic retries.

## Architecture & Key Components

### Core Client Pattern
- **Singleton**: `swell.init('store-id', 'secret-key')` from `src/index.ts`
- **Multi-client**: `swell.createClient('store-id', 'secret-key')` for multiple stores
- **Main class**: `Client` in `src/client.ts` handles all HTTP operations

### HTTP Client Recycling (Advanced Feature)
The client implements sophisticated HTTP connection management:
- **Recycling triggers**: Both `recycleAfterRequests` (default: 1000) AND `recycleAfterMs` (default: 15000ms) must be met
- **Connection pooling**: Uses `http-cookie-agent` with `tough-cookie` for persistent cookies
- **Cleanup**: Old clients are tracked until `activeRequests === 0`, then agents are destroyed
- **Callback**: `onClientRecycle` provides stats when recycling occurs

```typescript
// Example usage with recycling options
const client = new Client('store-id', 'key', {
  recycleAfterRequests: 500,
  recycleAfterMs: 10000,
  onClientRecycle: (stats) => console.log('Client recycled:', stats)
});
```

### Authentication & Headers
- **Auth**: Basic auth using Base64 encoded `store-id:secret-key`
- **User-Agent**: Automatically set to `swell-node@version`
- **X-User-Application**: Auto-detected from npm environment
- **Content-Type**: Always `application/json`

### Error Handling & Retries
- **Retry logic**: Only for specific error codes (`ECONNABORTED`, `ECONNREFUSED`)
- **No retries by default**: Set `retries: 3` explicitly
- **Custom error class**: `ApiError` with `code`, `status`, `headers`

## Development Workflows

### Testing
```bash
npm test                    # Run all tests
npm run test:watch         # Watch mode
npm test -- --testNamePattern="recycling"  # Specific tests
```

### Test Patterns
- **Mocking**: Uses `axios-mock-adapter` for HTTP mocking
- **Fake timers**: Client recycling tests use `jest.useFakeTimers()`
- **Error simulation**: `.timeoutOnce()`, `.replyOnce(500, 'error')`
- **Multi-scenario**: Test both success/failure paths for API calls

### Build & Release
```bash
npm run build              # TypeScript compilation to dist/
npm run lint               # ESLint + Prettier
npm run prettier           # Format code
```

## Critical Dependencies
- **axios**: HTTP client foundation
- **retry**: Exponential backoff retry logic  
- **tough-cookie + http-cookie-agent**: Persistent cookie handling
- **jest + ts-jest**: Testing framework
- **axios-mock-adapter**: HTTP mocking for tests

## Testing Client Recycling Features
When adding tests for recycling behavior:
1. Use `jest.useFakeTimers()` and `jest.advanceTimersByTime()`
2. Both request count AND time thresholds must be met
3. Check `getClientStats()` for active/old client counts
4. Mock agent `.destroy()` methods to verify cleanup
5. Test callback error handling with `console.warn` spy

## Common Patterns
- **Request transformation**: URL/data normalization in `transformRequest()`
- **Response handling**: Consistent error formatting via `transformError()`
- **Headers normalization**: Convert AxiosHeaders to plain objects
- **Module version**: Auto-extracted from `package.json`

## Integration Points
- **Swell Backend API**: Primary integration target
- **Cookie persistence**: Maintains session state across requests
- **Multi-store support**: Single process, multiple API clients
- **Environment detection**: Uses npm package vars for user-agent tracking
