# nestjs-aws-pubsub Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Address findings F-01 through F-17 and prioritized follow-ups P0–P3 in `docs/superpowers/specs/2026-04-25-nestjs-aws-pubsub-library-review-design.md` so the package typechecks, tests pass, Producer behavior is consistent, and README matches supported usage.

**Architecture:** Tight, incremental fixes per subsystem—`PubSubServer` (sqs-consumer v14 contracts + explicit ack behavior), `PubSubClient` (introspection API), `Producer` (client factory precedence, `batchSize`, SNS retry), then docs/Jest/cleanup. No new “reply over SQS” feature unless scope expands; F-11 is **documentation + dead-code clarity**, not a full request/reply transport.

**Tech stack:** TypeScript, NestJS 11 (`@nestjs/common`, `@nestjs/microservices`, `@nestjs/core`), AWS SDK v3 (SNS/SQS), `sqs-consumer` 14.x, Jest, ts-jest 29.

### Spec traceability (100%)

**Primary source:** `docs/superpowers/specs/2026-04-25-nestjs-aws-pubsub-library-review-design.md` (F-01–F-17, §2.4, §5, §6, §7 P0–P3).

| Finding or spec anchor | Plan |
|------------------------|------|
| **F-01** | Task 5 |
| **F-02** (code) | Task 2 |
| **F-02** (§5 / README API) | Task 2 Step 5 |
| **F-03** | Task 3 Step 3 |
| **F-04** | Task 3 Steps 1–2 |
| **F-05** | Task 3 Step 4 |
| **F-06** | Task 3 Step 4 |
| **F-07** (remove dead SQS batch path) | Task 3 Step 7 |
| **F-08** | Task 1 Steps 1–2 |
| **F-09** | Task 11 Step 2 (optional rethrow) + Task 11 Step 1a (README: current swallow + visibility) |
| **F-10** | Task 4 Step 1 |
| **F-11** (README) | Task 4 Step 2 |
| **F-11** (`PubSubServer.sendMessage` in code) | Task 4 Step 4 |
| **F-12** | Task 6 |
| **F-13** | Task 7 |
| **F-14** | Task 9 |
| **F-15** | Task 10 |
| **F-16** | Task 8 |
| **F-17** (README) | Task 11 Step 1 |
| **F-17** (`PubSubContext` JSDoc) | Task 11 Step 3 |
| **§5** “Batch processing” row (verify shape vs tests) | Task 1 Step 3 |
| **§5** “`unwrap`” row | Task 2 Step 5 |
| **§2.4** / **§6** quality gate | Task 12 |
| **§6** E2E optional | Task 12 Step 2 |
| **P0–P3** | Same tasks as in spec §7 table (this matrix maps 1:1) |

---

## File map (create / touch)

| File | Responsibility after work |
|------|----------------------------|
| `lib/pubsub.server.ts` | P0: Consumer callbacks (F-08); F-11 JSDoc on `sendMessage`; F-12 log noise; F-15 `replyQueueName` removal if unused. |
| `lib/pubsub.client.ts` | P0: `unwrap` (F-02); F-12 noisy logs. |
| `lib/pubsub.interface.ts` | P2: remove duplicate `PubSubModuleOptionsFactory` / `PubSubModuleAsyncOptions`. |
| `lib/producer/producer.ts` | P1: SQS/SNS `setup` (F-04), `batchSize` (F-03), SNS `publicMessage` catch (F-05), private SQS batch retry (F-06), remove dead SQS batch path (F-07, Task 3 Step 7). |
| `lib/pubsub.context.ts` | P3: JSDoc for nack/ops (F-17) only. |
| `lib/pubsub.decorator.ts` | P2: JSDoc; optional metadata test. |
| `lib/pubsub.server.spec.ts` | P0: still passes after server changes. |
| `lib/pubsub.client.spec.ts` | P0: test `unwrap` returns `Map` of producers. |
| `lib/pubsub.decorator.spec.ts` | P2 (new): `PubSubMessagePattern` applies metadata. |
| `README.md` | P1: `get(PubSubServer)` (F-10), reply (F-11), `unwrap` in API (F-02 §5), nack/DLQ (F-17), optional F-09. |
| `package.json` | P2: `clean` script targets `dist/`. |
| `jest.config.ts` | P2: move ts-jest options out of `globals` (F-13). |
| `test/sqs.e2e-spec.ts` | Optional: run when AWS/localstack available (document skip). |

---

## Task 1: P0 / F-08 — sqs-consumer v14 return types in `PubSubServer`

**Spec:** P0, F-08, §6 quality gate.

**Files:**

- Modify: `lib/pubsub.server.ts` (import `Message` from `sqs-consumer`; `Consumer.create` handler bodies; batch path only if Step 3 test fails)
- Test: `lib/pubsub.server.spec.ts` (Step 3: `true batch` test; no file edit if already green)
- Commands: `npm test` / `npx tsc -p . --noEmit` (project compiles; `include` is `lib/**/*` only)

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

- [ ] **Step 3: Verify spec §5 “Batch processing” contract (F-08 + `pubsub.server.spec.ts`)**

Spec row: handlers with `@PubSubMessagePattern(..., { batch: true })` receive a **grouped array**; see design spec **§5** and **§4** F-14.

Run only the multi-message batch test:

```bash
npx jest lib/pubsub.server.spec.ts -t "true batch" -v
```

Expected: **PASS** — `mockBatchHandler` is called with `expect.arrayContaining([ { data, context: PubSubContext }, ... ])` per existing assertions in `lib/pubsub.server.spec.ts` (lines ~125–130). If this test fails after Step 1, fix `handleMessageBatch` in `lib/pubsub.server.ts` so the `batch: true` branch calls `await handler(batch)` with `batch: Array<{ data: any; context: PubSubContext }>` and re-run this step.

- [ ] **Step 4: Commit** (amend message if Step 1–3 are one logical change, or keep two commits: F-08 types first, then batch test fix if any)

```bash
git add lib/pubsub.server.ts
git commit -m "fix(server): align sqs-consumer v14 handleMessage return types (F-08)"
```

If you changed batch behavior in the same work, use:

`git commit -m "fix(server): sqs-consumer v14 return types and batch handler contract (F-08, §5)"`

---

## Task 2: P0 / F-02 — `PubSubClient.unwrap` returns producers

**Spec:** P0, F-02; spec §5 “`unwrap`” row.

**Files:**

- Modify: `lib/pubsub.client.ts` (method `unwrap`)
- Modify: `lib/pubsub.client.spec.ts` (new or extended test)
- Modify: `README.md` (Step 5: document `unwrap` in PubSubClient API)

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

- [ ] **Step 4: Commit (unwrap implementation + test)**

```bash
git add lib/pubsub.client.ts lib/pubsub.client.spec.ts
git commit -m "fix(client): make unwrap return producers map (F-02)"
```

- [ ] **Step 5: README — spec §5 `unwrap` row (F-02 documentation)**

In `README.md`, in the **PubSubClient** API block (the `class PubSubClient` fenced section under “### PubSubClient”, ~line 406), add two lines so published API matches code:

```typescript
  // Introspection: map of named Producer instances (same as internal storage)
  unwrap<T = Map<string, import('./producer/producer').Producer>>(): T;
```

If you prefer to avoid `import` in a doc snippet, use plain text instead:

- `unwrap()` — returns the `Map` of `Producer` instances keyed by the `name` from config (introspection / debugging).

Run: no build required; optional `npm test` unchanged.

- [ ] **Step 6: Commit (README only)**

```bash
git add README.md
git commit -m "docs(readme): document PubSubClient.unwrap (F-02, §5)"
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

- [ ] **Step 5: F-07 — confirm no callers of private SQS batch `sendMessage`**

`public send()` in `lib/producer/producer.ts` must only call `sendMessageWithRetry` (SQS) and `publicMessage` (SNS). Verify with:

```bash
grep -n "private sendMessage\|sendSQSBatch\|public send" lib/producer/producer.ts
```

Expected: The **only** call to `sendSQSBatch` is from `private sendMessage` (SQS batch). The **only** SQS path from `public send` is `sendMessageWithRetry`. No other file imports `private sendMessage`.

- [ ] **Step 6: F-07 — remove dead SQS batch path (spec: “or remove dead paths”)**

Delete from `lib/producer/producer.ts` the **private** method `sendMessage` (SQS batch, the one taking `queueUrl, message, retries` — not `sendMessageWithRetry`) in full, and delete **`sendSQSBatch`** in full, because they are only referenced by each other and not by `public send`.

**Do not delete** `sendSNSBatch` (used from `publicMessage`).

After deletion, run:

```bash
npm test
npx tsc -p . --noEmit
```

If anything fails, restore and stop — but with current `public send`, this removal is the intended F-07 resolution.

- [ ] **Step 7: Run tests and commit (producer: F-03..F-07)**

```bash
npm test
git add lib/producer/producer.ts lib/producer/producer.spec.ts
git commit -m "fix(producer): client setup, batch size, SNS catch, remove dead SQS batch (F-03 to F-07)"
```

---

## Task 4: P1 / F-10, F-11, §5 — README accuracy (server bootstrap + reply semantics) + F-11 in code

**Spec:** P1, F-10, F-11, §5, design spec **§4** table row for `sendMessage` on server.

**Files:**

- Modify: `README.md`
- Modify: `lib/pubsub.server.ts` (F-11: JSDoc on `sendMessage` only; no new transport in this plan)

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

- [ ] **Step 3: Commit (README: F-10, F-11 text)**

```bash
git add README.md
git commit -m "docs(readme): correct PubSubServer usage and document no reply transport (F-10, F-11)"
```

- [ ] **Step 4: F-11 in-source — JSDoc on `PubSubServer.sendMessage`**

In `lib/pubsub.server.ts`, directly above the method `async sendMessage<T = any>(...)` (currently ~line 341), add:

```typescript
/**
 * Not a transport reply. Serializes a Nest `OutgoingResponse` and logs; does not publish to SQS/SNS.
 * @see F-11 in `docs/superpowers/specs/2026-04-25-nestjs-aws-pubsub-library-review-design.md`
 */
```

(Adjust line breaks to match your formatter.) No change to method body in this plan — spec chose **clarify**, not **implement** reply.

Run:

```bash
npm test
npx tsc -p . --noEmit
```

- [ ] **Step 5: Commit (F-11 code doc)**

```bash
git add lib/pubsub.server.ts
git commit -m "docs(server): JSDoc on sendMessage — no SQS/SNS reply transport (F-11)"
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
import { Reflector } from '@nestjs/core';
import { PUBSUB_HANDLER_OPTIONS, PubSubMessagePattern } from './pubsub.decorator';

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

- [ ] **Step 1a: README subsection “Ack / nack / visibility” (F-17)** — one short subsection stating: `nack()` is effectively visibility-timeout retry; operators configure DLQ / redrive on the queue. Link: `https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html` (or current AWS doc for DLQ).

- [ ] **Step 1b: README paragraph “Consumer errors and retries” (F-09)** — document **current** behavior: `Consumer.create` handlers in `PubSubServer` wrap `handleMessage` in `try/catch` and log errors, so unhandled **sync/async** throw inside user handlers is caught; combined with return `undefined` to `sqs-consumer` (see Task 1), visibility timeout drives redelivery. State explicitly that this may differ from “fail fast to DLQ” expectations, and that changing to **rethrow** is optional (see Step 2).

- [ ] **Step 2: Optional F-09 (code)** — in `Consumer.create` wrappers, rethrow `error` after `logger.error` if you want SQS to redeliver without relying on the catch swallow (behavior change). If you do, add “Breaking: …” in the commit and update Step 1b. If in doubt, **skip rethrow** and only ship README 1a/1b + context JSDoc.

- [ ] **Step 3: JSDoc on `PubSubContext` methods** in `lib/pubsub.context.ts` (nack, ack) clarifying SQS behavior.

- [ ] **Step 4: Commit**

```bash
git add README.md lib/pubsub.context.ts
# If and only if Step 2 rethrow: also `git add lib/pubsub.server.ts`
git commit -m "docs: nack, visibility, DLQ (F-17); consumer error behavior (F-09); context JSDoc"
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

## Plan self-review (post–100% traceability pass)

1. **Spec coverage:** The **“Spec traceability (100%)”** matrix at the top maps every F-01–F-17, §2.4, §5, §6, §7 item to a task and step. Exceptions: (a) spec **§2.1** “durable review record” describes the design doc, not this implementation plan; (b) spec **§3** architecture is descriptive—no build task. **F-11** is fully covered: README (Task 4) + JSDoc on `sendMessage` (Task 4 Step 4). **F-07** is fully covered: removal in Task 3 Step 6, not only a comment. **F-02** is fully covered: code+test (Task 2) + README (Task 2 Step 5). **§5 batch** is Task 1 Step 3. **F-09** is Task 11 Steps 1b + 2. No full SQS **reply** implementation (per spec).
2. **Placeholder scan:** No `TBD` / `TODO` steps; Task 3 includes concrete `setup` tests before `setup` rewrite.
3. **Type/signature consistency:** `unwrap` uses `Map<QueueName, Producer>`; `Message` is imported from `sqs-consumer` in `pubsub.server.ts` for consumer callback parameters. Task 2 Step 5 README `unwrap` lines match Task 2 Step 2 implementation.

---

## Plan complete

Plan saved to `docs/superpowers/plans/2026-04-25-nestjs-aws-pubsub-stabilization.md`. Two execution options:

**1. Subagent-Driven (recommended):** dispatch a fresh subagent per task, review between tasks, fast iteration. **REQUIRED SUB-SKILL:** `superpowers:subagent-driven-development` (or project equivalent `subagent-driven-development`).

**2. Inline execution:** work through checkboxes in this session with `superpowers:executing-plans` (batch with checkpoints for review).

Which approach do you want to use for implementation?
