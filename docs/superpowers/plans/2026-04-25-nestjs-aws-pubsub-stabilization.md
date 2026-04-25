# nestjs-aws-pubsub Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Address findings F-01 through F-17 and prioritized follow-ups P0–P3 in `docs/superpowers/specs/2026-04-25-nestjs-aws-pubsub-library-review-design.md` so the package typechecks, tests pass, Producer behavior is consistent, and README matches supported usage.

**Architecture:** Tight, incremental fixes per subsystem—`PubSubServer` (sqs-consumer v14 contracts + explicit ack behavior), `PubSubClient` (introspection API), `Producer` (client factory precedence, `batchSize`, SNS retry), then docs/Jest/cleanup. No new “reply over SQS” feature unless scope expands; F-11 is **documentation + dead-code clarity**, not a full request/reply transport.

**Tech stack:** TypeScript, NestJS 11 (`@nestjs/common`, `@nestjs/microservices`, `@nestjs/core`), AWS SDK v3 (SNS/SQS), `sqs-consumer` 14.x, Jest, ts-jest 29.

---

## File map (create / touch)

| File | Responsibility after work |
|------|----------------------------|
| `lib/pubsub.server.ts` | P0: Consumer callbacks return `Promise<Message \| undefined>` and `Promise<Message[] \| undefined>`; optional explicit `return` paths; F-12 log noise; F-15 `replyQueueName` removal if unused. |
| `lib/pubsub.client.ts` | P0: `unwrap` returns producer map; F-12 noisy logs. |
| `lib/pubsub.interface.ts` | P2: remove duplicate `PubSubModuleOptionsFactory` / `PubSubModuleAsyncOptions`. |
| `lib/producer/producer.ts` | P1: SQS/SNS `setup` precedence, `batchSize` init, SNS `publicMessage` catch, private SQS `sendMessage` retry, optional dead-code decision for batch helpers (F-07). |
| `lib/pubsub.context.ts` | P3: JSDoc for nack/ops (F-17) only. |
| `lib/pubsub.decorator.ts` | P2: JSDoc; optional metadata test. |
| `lib/pubsub.server.spec.ts` | P0: still passes after server changes. |
| `lib/pubsub.client.spec.ts` | P0: test `unwrap` returns `Map` of producers. |
| `lib/pubsub.decorator.spec.ts` | P2 (new): `PubSubMessagePattern` applies metadata. |
| `README.md` | P1: bootstrap without invalid `get(PubSubServer)`; F-11 reply limitations; F-17 nack/DLQ. |
| `package.json` | P2: `clean` script targets `dist/`. |
| `jest.config.ts` | P2: move ts-jest options out of `globals` (F-13). |
| `test/sqs.e2e-spec.ts` | Optional: run when AWS/localstack available (document skip). |

---

## Task 1: P0 / F-08 — sqs-consumer v14 return types in `PubSubServer`

**Spec:** P0, F-08, §6 quality gate.

**Files:**

- Modify: `lib/pubsub.server.ts` (import `Message` from `sqs-consumer`; `Consumer.create` handler bodies)
- Test: `npm test` / `npx tsc -p . --noEmit` (project compiles; `include` is `lib/**/*` only, so tsc on package root uses `tsconfig` as configured)

- [ ] **Step 1: Add `Message` import and explicit return in consumer callbacks**

At the top, add the type import next to the existing `Consumer` import:

```typescript
import { Consumer, type Message } from 'sqs-consumer';
```

Replace the `handleMessage` / `handleMessageBatch` property functions inside `Consumer.create({ ... })` in `listen()` (approximately lines 191–204) with:

```typescript
handleMessage: async (message: Message): Promise<Message | undefined> => {
  try {
    await this.handleMessage(message);
  } catch (error) {
    this.logger.error('Error handling message:', error);
  }
  return undefined;
},
handleMessageBatch: async (messages: Message[]): Promise<Message[] | undefined> => {
  try {
    await this.handleMessageBatch(messages);
  } catch (error) {
    this.logger.error('Error handling message batch:', error);
  }
  return undefined;
},
```

Rationale: `this.handleMessage` / `this.handleMessageBatch` already use `PubSubContext.ack()` (which uses `message.deleteMessage()` when present). Returning `undefined` tells the library **not** to acknowledge via the return contract; for your current design, **deletes are still driven by `ack()`** where applicable. The important fix is the **return type** matches v14, removing TS2322.

- [ ] **Step 2: Typecheck and run Jest**

Run:

```bash
cd /path/to/nest-sqs-event
npx tsc -p . --noEmit
npm test
```

Expected: `npx tsc` passes (or only pre-existing non-server errors, but server file must be clean). `pubsub.server.ts` compiles. `pubsub.server.spec.ts` suite runs to completion. If `tsc` reports issues because `include` is only `lib/`, run `npm run build` as an alternative (uses same `tsconfig`).

- [ ] **Step 3: Commit**

```bash
git add lib/pubsub.server.ts
git commit -m "fix(server): align sqs-consumer v14 handleMessage return types (F-08)"
```

---

## Task 2: P0 / F-02 — `PubSubClient.unwrap` returns producers

**Spec:** P0, F-02.

**Files:**

- Modify: `lib/pubsub.client.ts` (method `unwrap`)
- Modify: `lib/pubsub.client.spec.ts` (new or extended test)

- [ ] **Step 1: Write failing test first (TDD)**

In `lib/pubsub.client.spec.ts`, after `client.connect()` is exercised in a test, add:

```typescript
it('unwrap returns the internal producers map', async () => {
  await client.connect();
  const map = client.unwrap<typeof client.producers>();
  expect(map).toBe(client.producers);
  expect(map.size).toBeGreaterThan(0);
});
```

If `connect` is not called in an existing `beforeEach`, use the same pattern as other tests in that file that call `connect()`.

Run:

```bash
npx jest lib/pubsub.client.spec.ts -t "unwrap returns" --no-cache 2>&1
```

Expected: FAIL (unwrap throws "Client is not initialized" or wrong return) **until** implementation is fixed.

- [ ] **Step 2: Implement `unwrap`**

Replace the body of `unwrap` in `lib/pubsub.client.ts` with:

```typescript
public unwrap<T = Map<QueueName, import('./producer/producer').Producer>>(): T {
  return this.producers as T;
}
```

(Use a normal import at top: `import type { QueueName } from './pubsub.interface'` and `import type { Producer } from './producer/producer'`, and signature `public unwrap<T = Map<QueueName, Producer>>(): T` for cleaner typing without inline import.)

- [ ] **Step 3: Re-run the focused test, then full suite**

```bash
npx jest lib/pubsub.client.spec.ts -t "unwrap" -v
npm test
```

Expected: PASS, full `npm test` green.

- [ ] **Step 4: Commit**

```bash
git add lib/pubsub.client.ts lib/pubsub.client.spec.ts
git commit -m "fix(client): make unwrap return producers map (F-02)"
```

---

## Task 3: P1 / F-04, F-05, F-03, F-06, F-07 — Harden `Producer`

**Spec:** P1, F-04–F-07.

**Files:**

- Modify: `lib/producer/producer.ts`
- Test: add `lib/producer/producer.spec.ts` (new) for pure logic, or extend existing if present

- [ ] **Step 1: Add `lib/producer/producer.spec.ts` for `setup` behavior**

```typescript
import { SQSClient } from '@aws-sdk/client-sqs';
import { Producer } from './producer';

describe('Producer setup (F-04)', () => {
  const config = { accessKey: 'a', secretKey: 'b', region: 'us-east-1' };

  it('SQS: uses new SQSClient(sqsConfig) when sqsConfig is provided and option.sqs is absent', () => {
    const p = new Producer(
      { name: 'n', type: 'sqs', queueUrl: 'https://test', sqsConfig: { region: 'eu-west-1' } } as any,
      config,
    );
    expect((p as any)['sqs']).toBeInstanceOf(SQSClient);
  });
});
```

Add a second test for SNS: `type: 'sns'`, `snsConfig: { region: 'eu-west-1' }`, `expect((p as any)['sns']).toBeInstanceOf` with `import { SNSClient } from '@aws-sdk/client-sns'`.

- [ ] **Step 2: Rewrite `setup()` with explicit branches (F-04)**

In `lib/producer/producer.ts`, replace the SQS and SNS `if` bodies with explicit mutually exclusive conditions (pseudocode—implement exactly in TS):

```typescript
if (option.type === 'sqs') {
  if (option.sqs) {
    this.sqs = option.sqs;
  } else if (option.sqsConfig) {
    this.sqs = new SQSClient(option.sqsConfig);
  } else {
    this.sqs = new SQSClient({
      endpoint: config.endpoint || undefined,
      region: config.region,
      credentials: { secretAccessKey: config.secretKey, accessKeyId: config.accessKey },
    });
  }
} else if (option.type === 'sns') {
  if (option.sns) {
    this.sns = option.sns;
  } else if (option.snsConfig) {
    this.sns = new SNSClient(option.snsConfig);
  } else {
    this.sns = new SNSClient({
      endpoint: config.endpoint || undefined,
      region: config.region,
      credentials: { secretAccessKey: config.secretKey, accessKeyId: config.accessKey },
    });
  }
}
```

- [ ] **Step 3: Initialize `batchSize` in constructor (F-03)**

At end of `constructor` after `setup` call, add `this.batchSize = 10;` (AWS SQS / SNS batch max for standard use), or a named constant at class level: `private readonly batchSize = 10;` and **remove** the `private batchSize: number;` line without initial value.

- [ ] **Step 4: Fix `publicMessage` catch and private `sendMessage` (F-05, F-06)**

In `publicMessage` catch, replace the erroneous `return this.sendMessage(...)` (wrong target and wrong type) with a retry to **SNS** single publish. Extract or reuse the existing `publishSnsWithRetry` so the `catch` block does:

```typescript
if (retries > 0) {
  return this.publicMessage(
    topicArn,
    !Array.isArray(message) ? message : (message as Message[])[0],
    retries - 1,
  );
}
throw e;
```

(Adjust for array vs single—current `publicMessage` signature uses `Message | Message[]`.) If `e` is not a batch failure, fall back to per-message `publishSnsWithRetry` for a single `Message` instead of `publicMessage` to avoid infinite recursion. Match actual control flow; goal: **no call to SQS** `sendMessage` from the SNS path.

In private `sendMessage` (SQS batch), in the `catch` block, replace the `retries <= 0` branch: **throw** `e` on terminal failure instead of `return this.sendMessage(..., retries - 1)` with a negative `retries`.

- [ ] **Step 5: F-07 dead code — minimum documentation**

Add a one-line file-level or method-level comment above the **private** batch SQS `sendMessage` and related batch helpers: “Not used by public `send` in current build; keep for future batching or remove in a breaking cleanup.” (Do not delete in this pass unless a grep proves zero references; if unused, a follow-up commit can delete.)

- [ ] **Step 6: Run tests and commit**

```bash
npm test
git add lib/producer/producer.ts lib/producer/producer.spec.ts
git commit -m "fix(producer): client setup precedence, batch size, and SNS catch retry (F-03 to F-07)"
```

---

## Task 4: P1 / F-10, F-11, §5 — README accuracy (server bootstrap + reply semantics)

**Spec:** P1, F-10, F-11, §5.

**Files:**

- Modify: `README.md`

- [ ] **Step 1: Fix server bootstrap (remove invalid `get(PubSubServer)`)**

Replace the “Listen to internal events” block (around line 197) with a pattern that does **not** use `app.get(PubSubServer)`.

Use one of these **documented** options:

**Option A — Keep strategy instance in a variable** (no DI):

```typescript
const server = new PubSubServer({ /* same options as before */ });
const app = await NestFactory.createMicroservice(AppModule, { strategy: server });
server.on('message_received', (m) => { /* ... */ });
```

**Option B — Register in a custom provider** (document briefly that users must add `PubSubModule`-like registration themselves).

- [ ] **Step 2: Document no reply path (F-11)**

In “Server-Side Configuration” or a short “Request / reply” subsection, state: **Outgoing `send` / reply over SQS is not implemented;** `PubSubContext` and consume-side handlers are event-style only; do not assume request/response. Remove or rewrite any prose that suggests microservice `send` returns data over the wire.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(readme): correct PubSubServer usage and document no reply transport (F-10, F-11)"
```

---

## Task 5: P2 / F-01 — Deduplicate module async interfaces

**Spec:** P2, F-01.

**Files:**

- Modify: `lib/pubsub.interface.ts` (delete the second duplicate block, lines 91–100 in current tree)

- [ ] **Step 1: Remove duplicate `PubSubModuleOptionsFactory` and `PubSubModuleAsyncOptions`**

Delete lines 91 through 100, keeping a single `Message` interface and a single `PubSubModuleOptionsFactory` / `PubSubModuleAsyncOptions` group.

- [ ] **Step 2: Run tsc and tests**

```bash
npm test
```

- [ ] **Step 3: Commit**

```bash
git add lib/pubsub.interface.ts
git commit -m "fix(types): remove duplicate PubSubModule async interfaces (F-01)"
```

---

## Task 6: P2 / F-12 — Reduce hot-path `log` noise

**Spec:** P2, F-12.

**Files:**

- Modify: `lib/pubsub.server.ts` (trim `handleMessageBatch` verbose `JSON.stringify` to `debug` or a single `debug` line, or `verbose` if you add a flag; minimum: remove PII-style full message dump)
- Modify: `lib/pubsub.client.ts` (`createMessage` logging)

- [ ] **Step 1: In `createMessage`**, change `this.logger.log` to `this.logger.debug` (or remove duplicate logs) so one summary line at debug level remains, not three `log` lines per send.

- [ ] **Step 2: In `handleMessageBatch` first loop**, replace the large `JSON.stringify` `log` with a debug log of **ids and attribute keys** only, or delete the block if redundant with `message_received` events.

- [ ] **Step 3: `npm test` and commit**

```bash
git add lib/pubsub.server.ts lib/pubsub.client.ts
git commit -m "chore: reduce hot-path log noise (F-12)"
```

---

## Task 7: P2 / F-13 — Jest ts-jest config (no `globals` deprecation)

**Spec:** P2, F-13.

**Files:**

- Modify: `jest.config.ts`

- [ ] **Step 1: Replace `globals` with `transform` block**

```typescript
import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.json',
      },
    ],
  },
};

export default config;
```

- [ ] **Step 2: Run Jest, confirm no ts-jest globals warning**

```bash
npm test 2>&1 | head -30
```

Expected: no `globals` deprecation warning (or a reduced warning from ts-jest).

- [ ] **Step 3: Commit**

```bash
git add jest.config.ts
git commit -m "chore(jest): move ts-jest options to transform (F-13)"
```

---

## Task 8: P2 / F-16 — `package.json` clean script

**Spec:** P2, F-16.

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Set clean to remove build output**

```json
"clean": "rm -rf dist"
```

(If you also need to clean `lib` artifacts, add only if the project still emits to `lib/`; current `tsconfig` uses `outDir: "./dist"`.)

- [ ] **Step 2: Commit**

```bash
git add package.json
git commit -m "chore: fix clean script to target dist/ (F-16)"
```

---

## Task 9: P2 / F-14 — `PubSubMessagePattern` + Nest metadata

**Spec:** P2, F-14.

**Files:**

- Modify: `lib/pubsub.decorator.ts` (JSDoc)
- Create: `lib/pubsub.decorator.spec.ts`

- [ ] **Step 1: JSDoc on `PubSubMessagePattern`**

```typescript
/**
 * Binds a handler to a `pattern` string and optional PubSub options (`batch`, etc.).
 * `pattern` is stored in Nest’s default `metadataKey` used by the microservice layer — same key as `MessagePattern` in `@nestjs/microservices`.
 * `PubSubServer` also reads `PUBSUB_HANDLER_OPTIONS` for batch routing. Prefer one decorator style per handler to avoid double registration.
 */
```

(Verify in Nest: `SetMetadata` key for `MessagePattern` is `'pattern'`; if different in your version, read `node_modules/@nestjs/microservices/decorators/message-pattern.decorator.d.ts` and align the comment’s wording.)

- [ ] **Step 2: New test file** `lib/pubsub.decorator.spec.ts`:

```typescript
import { PUBSUB_HANDLER_OPTIONS } from './pubsub.decorator';
import { Reflector } from '@nestjs/core';
import { PubSubMessagePattern } from './pubsub.decorator';

describe('PubSubMessagePattern', () => {
  class TestController {
    @PubSubMessagePattern('p1', { batch: true })
    m() { return; }
  }

  it('sets PUBSUB_HANDLER_OPTIONS', () => {
    const r = new Reflector();
    const opts = r.get(PUBSUB_HANDLER_OPTIONS, TestController.prototype.m);
    expect(opts).toEqual({ batch: true });
  });
});
```

- [ ] **Step 3: `npm test` and commit**

```bash
git add lib/pubsub.decorator.ts lib/pubsub.decorator.spec.ts
git commit -m "test(decorator): assert PubSub handler metadata; document Nest alignment (F-14)"
```

---

## Task 10: P3 / F-15 — Unused `replyQueueName`

**Spec:** P3, F-15.

**Files:**

- Modify: `lib/pubsub.server.ts`, `lib/pubsub.client.ts`

- [ ] **Step 1: Grep and remove or wire**

```bash
grep -n replyQueueName lib/pubsub.server.ts lib/pubsub.client.ts
```

If there are no reads, **delete** the `private replyQueueName?: string` (and the empty `if (this.replyQueueName)` in client) in both files.

- [ ] **Step 2: `npm test` and commit**

```bash
git add lib/pubsub.server.ts lib/pubsub.client.ts
git commit -m "chore: remove unused replyQueueName placeholders (F-15)"
```

---

## Task 11: P3 / F-09, F-17 — Docs and nack

**Spec:** P3, F-09, F-17; light touch on F-09 (full behavior change = separate ADR).

**Files:**

- Modify: `README.md` (F-17, optional F-09)
- Optional modify: `lib/pubsub.server.ts` (F-09 only if you document “rethrow to consumer” in same commit)

- [ ] **Step 1: README subsection “Ack / nack / visibility”** explaining that `nack()` is visibility-timeout retry, operators should use DLQ/redrive policies; link to AWS docs in one line.

- [ ] **Step 2: Optional F-09** — in `Consumer.create` wrappers, rethrow `error` after `logger.error` if you want queue retry on handler failure (behavior change). If you do, add a “Breaking: …” line in the commit message and a README note. If in doubt, **only document** current swallow behavior for this task.

- [ ] **Step 3: JSDoc on `PubSubContext` methods** in `lib/pubsub.context.ts` (nack, ack) clarifying SQS behavior.

- [ ] **Step 4: Commit**

```bash
git add README.md lib/pubsub.context.ts
git commit -m "docs: operator guidance for nack, visibility, and DLQ (F-17); optional F-09 note"
```

---

## Task 12: Verification (release-style gate)

**Spec:** §6, §2.4.

**Files:** none (commands only)

- [ ] **Step 1: Full build and test**

```bash
npm run clean
npm run build
npm test
npx tsc -p . --noEmit
```

- [ ] **Step 2: (Optional) E2E** — `test/sqs.e2e-spec.ts` only with env pointing at LocalStack or a dev queue; document in README that e2e is opt-in. Skip in CI if no creds.

---

## Plan self-review

1. **Spec coverage:** P0 (F-08, F-02) → Task 1–2. P1 producer + README → 3–4. P2 (F-01, F-12, F-13, F-16, F-14) → 5–9. P3 (F-15, F-09, F-17) → 10–11. F-11 in README Task 4; **no** full SQS reply implementation (per spec ambiguity resolution). F-10 README Task 4.
2. **Placeholder scan:** No `TBD` / `TODO` steps; Task 3 includes concrete `setup` tests before implementation changes.
3. **Type/signature consistency:** `unwrap` uses `Map<QueueName, Producer>`; `Message` is imported from `sqs-consumer` in `pubsub.server.ts` for consumer callback parameters.

---

## Plan complete

Plan saved to `docs/superpowers/plans/2026-04-25-nestjs-aws-pubsub-stabilization.md`. Two execution options:

**1. Subagent-Driven (recommended):** dispatch a fresh subagent per task, review between tasks, fast iteration. **REQUIRED SUB-SKILL:** `superpowers:subagent-driven-development` (or project equivalent `subagent-driven-development`).

**2. Inline execution:** work through checkboxes in this session with `superpowers:executing-plans` (batch with checkpoints for review).

Which approach do you want to use for implementation?
