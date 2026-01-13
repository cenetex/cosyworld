# CosyWorld Testing Guide

**Version**: 0.0.11  
**Test Framework**: Vitest  
**Coverage Tool**: c8  
**Last Updated**: October 15, 2025

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Running Tests](#running-tests)
3. [Writing Tests](#writing-tests)
4. [Test Structure](#test-structure)
5. [Mocking](#mocking)
6. [Coverage](#coverage)
7. [Best Practices](#best-practices)
8. [CI/CD Integration](#cicd-integration)

---

## Getting Started

### Prerequisites

- Node.js 18.18 or higher
- npm installed
- CosyWorld dependencies installed (`npm install`)

### Installation

Test dependencies are included in the project. If you need to reinstall:

```bash
npm install --save-dev vitest @vitest/ui c8 sinon
```

---

## Running Tests

### Run All Tests

```bash
npm test
```

This runs all tests once and exits (CI mode).

### Watch Mode (Development)

```bash
npm run test:watch
```

Tests automatically re-run when files change. Perfect for TDD!

### UI Mode (Interactive)

```bash
npm run test:ui
```

Opens a browser-based UI for exploring tests, viewing coverage, and debugging.

### Coverage Report

```bash
npm run test:coverage
```

Generates a full coverage report in:
- Terminal (text summary)
- `coverage/index.html` (detailed HTML report)
- `coverage/lcov.info` (for CI tools)

### Run Specific Test Files

```bash
# Run single test file
npx vitest test/services/ai/aiModelService.test.mjs

# Run tests matching pattern
npx vitest test/services/avatar

# Run only tests with "Combat" in the name
npx vitest --grep="Combat"
```

### Debug Mode

```bash
# Run with verbose output
DEBUG=* npm test

# Run single test with debugging
node --inspect-brk ./node_modules/.bin/vitest run test/services/ai/aiModelService.test.mjs
```

---

## Writing Tests

### Basic Test Structure

```javascript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MyService } from '../../../src/services/myService.mjs';

describe('MyService', () => {
  let service;

  beforeEach(() => {
    // Setup before each test
    service = new MyService();
  });

  afterEach(() => {
    // Cleanup after each test
    vi.clearAllMocks();
  });

  describe('Feature Group', () => {
    it('should do something specific', () => {
      // Arrange
      const input = 'test';

      // Act
      const result = service.doSomething(input);

      // Assert
      expect(result).toBe('expected');
    });
  });
});
```

### Async Tests

```javascript
it('should fetch data asynchronously', async () => {
  const data = await service.fetchData();
  expect(data).toBeDefined();
});
```

### Testing Errors

```javascript
it('should throw error on invalid input', () => {
  expect(() => service.validate(null)).toThrow('Invalid input');
});

it('should reject promise on failure', async () => {
  await expect(service.asyncOperation()).rejects.toThrow('Operation failed');
});
```

---

## Test Structure

### Directory Layout

```
test/
├── setup.mjs                      # Global test configuration
├── helpers/                       # Test utilities
│   ├── mockServices.mjs          # Mock service factories
│   └── testData.mjs              # Test data fixtures
└── services/                      # Mirror src/services structure
    ├── ai/
    │   ├── aiModelService.test.mjs
    │   └── unifiedAIService.test.mjs
    ├── avatar/
    │   └── avatarService.test.mjs
    ├── combat/
    │   └── combatService.test.mjs
    └── tools/
        └── toolService.test.mjs
```

### Test File Naming

- Test files: `*.test.mjs` or `*.spec.mjs`
- Location: Mirror source structure in `test/` directory
- Example: `src/services/avatar/avatarService.mjs` → `test/services/avatar/avatarService.test.mjs`

---

## Mocking

### Using Mock Services

We provide pre-built mock services in `test/helpers/mockServices.mjs`:

```javascript
import { createMockLogger, createMockDatabaseService } from '../../helpers/mockServices.mjs';

describe('MyService', () => {
  let service;
  let mockDb;
  let mockLogger;

  beforeEach(() => {
    mockDb = createMockDatabaseService();
    mockLogger = createMockLogger();

    service = new MyService({
      databaseService: mockDb,
      logger: mockLogger,
    });
  });

  it('should log database queries', async () => {
    await service.query();
    expect(mockLogger.info).toHaveBeenCalled();
  });
});
```

### Available Mock Services

- `createMockLogger()` - Winston-compatible logger
- `createMockDatabaseService()` - MongoDB service
- `createMockConfigService()` - Configuration service
- `createMockSecretsService()` - Secrets encryption service
- `createMockAIService()` - AI provider service
- `createMockAvatarService()` - Avatar CRUD service
- `createMockMemoryService()` - Memory storage service
- `createMockEventBus()` - Event emitter
- `createMockContainer()` - Awilix DI container

### Custom Mocks with Vitest

```javascript
import { vi } from 'vitest';

// Mock a function
const mockFn = vi.fn();
mockFn.mockReturnValue('mocked value');
mockFn.mockResolvedValue('async value');

// Mock a module
vi.mock('../../../src/services/myService.mjs', () => ({
  MyService: vi.fn().mockImplementation(() => ({
    doSomething: vi.fn().mockReturnValue('mocked'),
  })),
}));

// Spy on existing method
const spy = vi.spyOn(service, 'methodName');
expect(spy).toHaveBeenCalledWith('arg');
```

### Mocking Timers

```javascript
import { vi } from 'vitest';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
});

it('should call function after delay', () => {
  const callback = vi.fn();
  setTimeout(callback, 1000);

  vi.advanceTimersByTime(1000);
  expect(callback).toHaveBeenCalled();
});
```

---

## Coverage

### Coverage Targets

Current targets (defined in `vitest.config.js`):

- **Lines**: 60%
- **Functions**: 60%
- **Branches**: 60%
- **Statements**: 60%

### Viewing Coverage

```bash
# Generate coverage report
npm run test:coverage

# Open HTML report in browser
open coverage/index.html
```

### Coverage Reports

- **Text**: Console output (summary)
- **HTML**: `coverage/index.html` (detailed, browsable)
- **JSON**: `coverage/coverage-final.json` (machine-readable)
- **LCOV**: `coverage/lcov.info` (for CI tools like Codecov)

### Excluding Files from Coverage

Files excluded (configured in `vitest.config.js`):
- `node_modules/`
- `dist/`
- `public/`
- `docs/`
- `infra/`
- `scripts/`
- `**/*.config.{js,mjs}`
- `**/*.test.{js,mjs}`

---

## Best Practices

### 1. Test Organization

- **Arrange-Act-Assert (AAA)**: Structure tests clearly
- **One assertion per test**: Keep tests focused
- **Descriptive names**: Use "should" in test descriptions

```javascript
it('should return avatar when found by ID', async () => {
  // Arrange
  const avatarId = 'test-id';
  mockDb.collection.findOne.mockResolvedValue({ avatarId, name: 'Test' });

  // Act
  const result = await service.findByAvatarId(avatarId);

  // Assert
  expect(result).toEqual({ avatarId, name: 'Test' });
});
```

### 2. Isolation

- **No shared state**: Each test should be independent
- **Mock external dependencies**: Database, APIs, file system
- **Reset mocks**: Use `beforeEach` to reset state

```javascript
beforeEach(() => {
  vi.clearAllMocks();
  vi.resetAllMocks();
});
```

### 3. Test Data

Use test data fixtures from `test/helpers/testData.mjs`:

```javascript
import { createTestAvatar, createTestItem } from '../../helpers/testData.mjs';

it('should add item to avatar inventory', () => {
  const avatar = createTestAvatar();
  const item = createTestItem();

  avatar.inventory.push(item.itemId);
  expect(avatar.inventory).toContain(item.itemId);
});
```

### 4. Edge Cases

Always test edge cases:

```javascript
describe('Edge Cases', () => {
  it('should handle null input', () => {
    expect(service.process(null)).toBeNull();
  });

  it('should handle empty array', () => {
    expect(service.process([])).toEqual([]);
  });

  it('should handle maximum values', () => {
    expect(service.process(Number.MAX_SAFE_INTEGER)).toBeDefined();
  });
});
```

### 5. Async Testing

```javascript
// ✅ Good - async/await
it('should load data', async () => {
  const data = await service.loadData();
  expect(data).toBeDefined();
});

// ❌ Bad - missing await
it('should load data', () => {
  const data = service.loadData();
  expect(data).toBeDefined(); // Will fail - data is a Promise!
});
```

### 6. Error Testing

```javascript
it('should throw on invalid input', () => {
  expect(() => service.validate('')).toThrow('Invalid input');
});

it('should reject on async error', async () => {
  await expect(service.asyncOp()).rejects.toThrow('Operation failed');
});
```

---

## CI/CD Integration

### GitHub Actions

Create `.github/workflows/test.yml`:

```yaml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run linter
        run: npm run lint
      
      - name: Run tests
        run: npm test
      
      - name: Generate coverage
        run: npm run test:coverage
      
      - name: Upload coverage to Codecov
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/lcov.info
```

### Pre-commit Hook

Tests run automatically before commits (configured in `.git/hooks/pre-commit`):

```bash
#!/bin/sh
npm run lint && npm test
```

### NPM Scripts Integration

```json
{
  "scripts": {
    "precommit": "npm run lint && npm test",
    "prepush": "npm run test:coverage",
    "predeploy": "npm run lint && npm run build && npm test"
  }
}
```

---

## Troubleshooting

### Tests Hanging

```bash
# Increase timeout
npx vitest --test-timeout=20000

# Check for open handles
npx vitest --no-threads
```

### Import Errors

```bash
# Ensure ES modules are used (.mjs extension)
# Check vitest.config.js for correct resolve.alias settings
```

### Coverage Not Generating

```bash
# Install c8 coverage provider
npm install --save-dev c8

# Run with explicit provider
npx vitest --coverage.provider=c8
```

### Mock Not Working

```javascript
// Ensure mocks are created before importing module
vi.mock('./module.mjs');
import { module } from './module.mjs';

// Not the other way around!
```

---

## Test Coverage Roadmap

### Phase 1: Critical Services (Current) ✅
- [x] AIModelService - Model registry and selection
- [x] AvatarService - Avatar CRUD operations
- [x] ToolService - Tool registration and execution
- [x] Combat System - Battle mechanics

### Phase 2: Core Services (Next 2 weeks)
- [ ] UnifiedAIService - AI provider abstraction
- [ ] OpenRouterAIService - OpenRouter integration
- [ ] MemoryService - Memory storage and retrieval
- [ ] DatabaseService - MongoDB operations

### Phase 3: Integration Tests (Next 4 weeks)
- [ ] Message handling flow (Discord → AI → Response)
- [ ] Tool decision and execution pipeline
- [ ] Combat session lifecycle
- [ ] Avatar creation and evolution

### Phase 4: E2E Tests (Future)
- [ ] Discord bot commands
- [ ] Web UI flows
- [ ] X/Twitter posting
- [ ] NFT minting

---

## Resources

- **Vitest Documentation**: https://vitest.dev/
- **Testing Best Practices**: https://testingjavascript.com/
- **Jest → Vitest Migration**: https://vitest.dev/guide/migration.html
- **Coverage Reports**: `coverage/index.html` after running `npm run test:coverage`

---

## Contributing

When adding new features:

1. Write tests first (TDD approach)
2. Ensure 60%+ coverage for new code
3. Run full test suite before committing: `npm test`
4. Update this README if adding new test utilities

---

**Happy Testing! 🧪**

*For questions or issues, see the main README.md or open an issue on GitHub.*
