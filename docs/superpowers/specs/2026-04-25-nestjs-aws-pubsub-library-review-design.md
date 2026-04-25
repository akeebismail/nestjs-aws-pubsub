# Design: Library review record — nestjs-aws-pubsub

**Status:** Design / audit snapshot  
**Package:** `nestjs-aws-pubsub` (repo path: `nest-sqs-event`)  
**Date:** 2026-04-25  
**Review lens:** Balanced (operators, package consumers, maintainers)

---

## 1. Executive summary

This document captures a **balanced technical review** of the NestJS AWS pub/sub library: architecture as implemented today, a **single severity-tagged findings catalog** with audience tags, gaps between **README and code**, test health, and a **prioritized follow-up list** for a separate implementation plan. It does **not** implement fixes; implementation work is out of scope here.

---

## 2. Purpose, scope, and success criteria

### 2.1 Purpose

- Provide a **durable, commit-tracked** record of what the library does, what is **solid**, and what is **risky or incomplete**.
- Enable stakeholders (operators, consumers, maintainers) to **filter** by tag without reading three separate reports.

### 2.2 In scope

- Source under `lib/`, public exports in `lib/index.ts`, and published surface implied by `package.json` (`main` / `types` → `dist/`).
- `README.md` claims versus observable behavior in code.
- Unit tests under `lib/*.spec.ts`, e2e under `test/`, and `npm test` as a **quality signal** (compile + run).
- Runtime concerns for SQS/SNS: credentials, message shape, ack/nack semantics, and observability hooks **as they appear in code**.

### 2.3 Out of scope (this document)

- Code changes, dependency upgrades, or CI configuration changes.
- Full AWS security audit of a deployed account (only **library-adjacent** foot-guns are listed).
- Performance benchmarking or load testing.

### 2.4 Success criteria

A reader can: (1) **understand** how the pieces connect, (2) **see** what to fix first and **why**, (3) hand off **section 7** to an implementation plan without re-walking the repository.

---

## 3. Reference architecture and data flow

### 3.1 Components

| Unit | Responsibility | Key dependencies |
|------|----------------|------------------|
| `PubSubModule` | Global dynamic module: registers `PUBSUB_OPTIONS` and constructs a **connected** `PubSubClient`. | Nest `@Module`, `PubSubClient` |
| `PubSubClient` | Producer side: `sendMessage` / `emit` / `dispatchEvent`; builds `Message` (body + `messageAttributes` for `pattern` and `id`); uses internal `Producer` per named queue/topic. | `ClientProxy`, custom `lib/producer/producer.ts` |
| `PubSubServer` | Consumer side: one or more `sqs-consumer` instances; `handleMessage` / `handleMessageBatch`; JSON parse; optional **SNS envelope** unwrap; routes by `pattern` (attributes or body); `PubSubContext` for ack/nack; internal `EventEmitter` for observability events. | `sqs-consumer`, Nest `Server` |
| `PubSubContext` | RPC context: raw SQS message, pattern; `ack` delegates to `message.deleteMessage()` if present. | `BaseRpcContext` |
| `PubSubMessagePattern` | Custom decorator: sets `pattern` metadata and `PUBSUB_HANDLER_OPTIONS` (e.g. `batch: true`) for `PubSubServer` batch path. | Nest `SetMetadata`, `Reflector` in server |
| `Producer` | AWS SDK: SQS `SendMessageCommand` / batch helpers; SNS `PublishCommand` / batch helpers; retry loops on the **simple** send/publish paths used by `PubSubClient`. | `@aws-sdk/client-sqs`, `@aws-sdk/client-sns` |

### 3.2 Message flow (produce)

1. Callers use `PubSubClient.sendMessage(pattern, data, { name })` (or `emit` / `dispatchEvent`).
2. Client serializes a packet, builds a **SQS-style** `Message` (`body` = JSON of **data** portion per `createMessage`, attributes carry `pattern` and `id`).
3. `Producer.send` dispatches to SQS or SNS based on the named producer’s `type`.

### 3.3 Message flow (consume)

1. `sqs-consumer` receives SQS messages (attributes requested with `messageAttributeNames: ['All']` in current server setup).
2. Server parses `Body`, optionally unwraps SNS `Notification` JSON.
3. `pattern` is read from SQS **message attributes** (`pattern.StringValue`) or from JSON **body** (`rawMessage.pattern`).
4. `deserializer` produces an `IncomingRequest`-like shape; **handler** receives `packet.data` and `PubSubContext`.
5. If handler returns `true` / `false`, server may `ack` / `nack`; `PubSubContext.ack` calls `deleteMessage` when the underlying object exposes it (depends on `sqs-consumer` message shape).

This section is **descriptive of current code**, not a target architecture.

---

## 4. Findings catalog

**Severity** legend: **Critical** (build broken, data loss, security in typical misuse), **High** (runtime failure, wrong behavior for common case), **Medium** (incomplete feature, bad DX, fixable type errors), **Low** (cleanup, dead code, noisy logs).

**Tags:** `ops`, `api-consumer`, `maintainer`, `docs`.

| ID | Severity | Tags | Summary | Evidence / notes |
|----|----------|------|---------|------------------|
| F-01 | Medium | maintainer | Duplicate TypeScript interface declarations in `pubsub.interface.ts` (`PubSubModuleOptionsFactory`, `PubSubModuleAsyncOptions` appear twice). | `lib/pubsub.interface.ts` |
| F-02 | High | api-consumer | `PubSubClient.unwrap()` throws: `this.client` is never assigned; method appears unusable. | `lib/pubsub.client.ts` |
| F-03 | High | maintainer, ops | `Producer` declares `batchSize` but does not assign it; batch helpers (`sendSQSBatch` / `sendSNSBatch`) add `startIndex + this.batchSize` (NaN if undefined) if ever called. | `lib/producer/producer.ts` |
| F-04 | High | maintainer | SQS client bootstrap uses `option.sqs || option.sqsConfig ? new SQSClient(...)` without parentheses; **operator precedence** can skip intended credential-based client when `sqsConfig` is set. Same pattern for SNS. | `lib/producer/producer.ts` `setup` |
| F-05 | High | maintainer | SNS path `publicMessage` catch block calls `this.sendMessage(...)` (private SQS batch method) with **topicArn**; wrong method for retry/fallback. | `lib/producer/producer.ts` end of `publicMessage` |
| F-06 | Medium | maintainer | Private `sendMessage` (SQS batch) has suspicious retry: on `retries <= 0` it calls `this.sendMessage(queueUrl, message, retries - 1)` (further negative). | `lib/producer/producer.ts` |
| F-07 | Medium | maintainer | `Producer.send` uses `sendMessageWithRetry` (SQS) and `publicMessage` (SNS) only; **private SQS `sendMessage` batch path** is not used by `send` — batch utilities may be **dead or unfinished**. | `lib/producer/producer.ts` |
| F-08 | High | maintainer, ops | `PubSubServer` fails **TypeScript compile** with `sqs-consumer` v14: `handleMessage` / `handleMessageBatch` must return `Message` / `Message[]` per consumer types, implementations return `void`. | `lib/pubsub.server.ts`, `npm test` (server spec / compile) |
| F-09 | Medium | maintainer, ops | Catching errors in consumer wrappers may **swallow** failures and affect visibility timeout / retry behavior depending on `sqs-consumer` contract. | `listen()` inner try/catch around `handleMessage` / `handleMessageBatch` |
| F-10 | High | api-consumer, docs | README shows `app.get(PubSubServer)` after `createMicroservice` with a **custom strategy**; `PubSubModule` does **not** register `PubSubServer` as a provider — example is **likely wrong** for typical Nest setup unless manually provided. | `README.md` server section vs `lib/pubsub.module.ts` |
| F-11 | High | api-consumer, ops | `PubSubServer.sendMessage` serializes and **logs** only; it does not send a reply to SQS/SNS. Any “reply” path in `handleMessage` is **non-functional** for request/response. | `lib/pubsub.server.ts` `sendMessage` |
| F-12 | Medium | maintainer | Noisy / sensitive **debug-style logging** (full message JSON, packets) in hot paths. | `PubSubServer.handleMessageBatch`, `PubSubClient.createMessage` |
| F-13 | Low | maintainer, docs | Jest / ts-jest **deprecation** warning: `globals` for ts-jest should move to `transform`. | `jest` run output |
| F-14 | Medium | maintainer, api-consumer | `@PubSubMessagePattern` sets `SetMetadata('pattern', pattern)`; alignment with Nest core **message pattern metadata** and registration should be **verified** when mixing with `@MessagePattern` / `@EventPattern` from `@nestjs/microservices`. | `lib/pubsub.decorator.ts` vs Nest conventions |
| F-15 | Low | maintainer | `this.replyQueueName` in `PubSubServer` and `PubSubClient` is unused or placeholder. | `lib/pubsub.server.ts`, `lib/pubsub.client.ts` |
| F-16 | Low | maintainer, docs | `npm run clean` script targets `lib/*.js` but build outputs to `dist/`; script may be **stale** relative to `tsconfig` `outDir`. | `package.json` vs `tsconfig.json` |
| F-17 | ops | `PubSubContext.nack` is a **no-op** (visibility timeout drives retry) — **documented as intentional** in code comments; operators must set queue redrive / DLQ. | `lib/pubsub.context.ts` |

*Tagging for F-17:* `ops` primary; `api-consumer` if behavior is surprising.

---

## 5. Documentation vs code

| Topic | README / claims | Code reality |
|-------|-----------------|-------------|
| Microservice server access | Suggests `app.get(PubSubServer)` for events | `PubSubServer` is not exported from module as injectable; strategy is passed to `createMicroservice` (F-10). |
| Request/response or replies | Implied by microservice `send` patterns | `sendMessage` on server does not perform outbound send (F-11). |
| `PubSubClient.unwrap` | (If documented as ClientProxy pattern) | Broken until `this.client` defined (F-02). |
| Batch processing | Handlers with `{ batch: true }` | Implemented in `handleMessageBatch` with reflector; worth verifying handler signature vs tests (single vs array batch) when fixing F-08. |
| “Zero boilerplate” / autoconnect | Global module calls `client.connect()` in factory | Accurate for module path; standalone usage must still call `connect` (README covers both). |

---

## 6. Testing and CI

| Signal | State |
|--------|--------|
| `lib/pubsub.client.spec.ts` | **Passes** (per last `npm test` run: tests executed). |
| `lib/pubsub.server.spec.ts` | **Does not run** to completion: **TypeScript** errors in `pubsub.server.ts` vs `sqs-consumer` types (F-08). |
| E2E | `test/sqs.e2e-spec.ts` present; not re-run as part of this spec write — should be part of a future **green CI** goal. |
| `npm test` overall | **Exit non-zero** due to failed server spec compilation. |

**Quality gate (recommended for follow-up):** `npm test` and `npx tsc --noEmit` (or `npm run build`) should pass on `main` before release.

---

## 7. Prioritized follow-ups (for implementation plan — not the plan itself)

| Priority | Related IDs | One-line intent |
|----------|-------------|-----------------|
| P0 | F-08 | Align `handleMessage` / `handleMessageBatch` with `sqs-consumer` v14 contracts; restore **green** `npm test`. |
| P0 | F-02 | Fix or remove `PubSubClient.unwrap` and document supported introspection API. |
| P1 | F-04, F-05, F-06, F-03, F-07 | Harden `Producer` setup, retries, and batch code paths (or remove dead paths). |
| P1 | F-10, F-11, §5 | Correct README: server injection pattern; clarify **no reply transport** or implement it. |
| P2 | F-01, F-12, F-13, F-16 | Types cleanup, log levels, Jest config, `clean` script. |
| P2 | F-14 | Document or test interaction between `PubSubMessagePattern` and Nest’s pattern registration. |
| P3 | F-09, F-15, F-17 | Document error handling / nack semantics; remove or use `replyQueueName`. |

---

## 8. Self-review (spec quality)

- **Placeholders:** None intentional; e2e not re-executed in this pass — **explicit** in §6.
- **Consistency:** Architecture (§3) matches findings; priorities (§7) reference finding IDs in §4.
- **Scope:** Single implementation **theme** (stabilize consumer types + producer + docs) is appropriate for one plan; large features (e.g. full request-reply) should be a **separate** decision after F-11 clarity.
- **Ambiguity:** “Release” and “CI” are implied next steps, not required by this spec.

---

## Document history

| Version | Date | Note |
|---------|------|------|
| 1.0 | 2026-04-25 | Initial balanced review design snapshot |
