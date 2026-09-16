# Task workflow playbook

Cross-tool orchestration guidance — the thing each tool's own `description`
can't say by itself, because a tool only knows about itself, not the
sequence it belongs to. Served as an MCP resource (`bx24://docs/task-workflow-playbook`)
so any client can pull it in, not baked into every tool description (that
would tax every single turn — see the note at the bottom).

Addresses [issue #107](https://github.com/bitrix24/templates-mcp/issues/107).

## 1. Building a task up, step by step

`b24_task_create` always comes first — every other tool below needs the
`id` it returns.

After that, the pieces attach in any order **except** where noted:

| Tool | Depends on | Notes |
|---|---|---|
| `b24_task_checklist_item_add` | task exists | Pure addition, no ordering constraint. |
| `b24_task_result_add` | task exists | v3 transport (`tasks.task.result.*`) — everything else in this table is v2. Error codes look different if something fails here (`BITRIX_REST_V3_EXCEPTION_*`), not a bug. |
| `b24_task_elapsed_time_add` | task exists | Pure addition. |
| `b24_task_tag_add` | task exists | Read-merge-write — safe to call repeatedly, safe to call before or after other steps. |
| `b24_task_auditor_add` | task exists | Same read-merge-write shape as tags. |
| `b24_task_file_attach` | task exists **in the file's own project** | The file and the task must share the same `groupId`'s Disk storage — attaching across projects fails with a generic, unhelpful error naming neither the file nor the reason (found by live testing, undocumented by Bitrix24). |
| `b24_task_dependency_add` | **BOTH** `taskIdFrom` and `taskIdTo` already exist | Create every task in the chain first, then link. Re-linking the same pair fails `ILLEGAL_NEW_LINK` — not idempotent, and there's no read-back tool (`task.item.getdependson` was deprecated server-side with no v3 replacement), so check for an existing link in the Bitrix24 UI before retrying. |

Everything in this table works standalone too — none of it requires the
others. The only hard ordering rule is "the task (and, for dependencies,
BOTH tasks) must exist first."

## 2. "Прими задачу" — which tool did the operator mean?

Two different actions collide under one phrase, and the tools don't
disambiguate it for you:

- **(a) The responsible user accepting the assignment** (принять/отклонить
  назначение). **No tool exists for this yet** —
  [issue #8](https://github.com/bitrix24/templates-mcp/issues/8) is open,
  not shipped.
- **(b) The creator approving work reported as done** — `b24_task_approve`
  / `b24_task_disapprove`.

If the operator is the **creator** reviewing work someone else reported
done, they mean (b). If they're the **responsible user** being handed a
brand-new task, they mean (a) — and there is currently nothing to call;
say so rather than silently routing to (b).

### The (b) flow, in order

1. Responsible user calls `b24_task_complete`.
   - If the task has `taskControl: Y` → status becomes **4 (Supposedly
     completed)** and step 2 is required.
   - Otherwise → status goes straight to **5 (Completed)**. Done, no
     approval step exists for this task.
2. Creator calls one of:
   - `b24_task_approve` → **5 (Completed)**.
   - `b24_task_disapprove` → **2 (Pending)**, for rework. **Post the
     rejection comment via `b24_task_comment_add` FIRST** — Bitrix24 shows
     the comment at the moment of rejection, so posting it after leaves a
     rejection with no visible reason.

Both `approve` and `disapprove` require `taskControl` to have been on AND
the task to actually be at status 4 — calling either on a task that
completed straight to 5 (no task control) fails, because there is nothing
to approve.

## 3. Full status transition map

Bitrix24 task statuses (see `server/utils/tasks.ts`'s `TASK_STATUS` for the
canonical list): 1 new · 2 pending · 3 in progress · 4 supposedly completed
· 5 completed · 6 deferred · 7 declined.

| Tool | Transition |
|---|---|
| `b24_task_start` | 2 → 3 |
| `b24_task_pause` | 3 → 2 |
| `b24_task_complete` | 3 → 4 (task control on) or 3 → 5 (task control off) |
| `b24_task_approve` | 4 → 5 |
| `b24_task_disapprove` | 4 → 2 |
| `b24_task_defer` | 2 or 3 → 6 |
| `b24_task_renew` | 5 or 6 → 2 |

If a task is already at the target status, Bitrix24 returns "action not
allowed" for most of these — treat that as already-applied, not a real
failure (see each tool's own description for the exact wording).

## Why this is a resource, not baked into tool descriptions

Every MCP tool's schema+description is sent to the model on **every**
turn — this server's 47 tools already cost ~6.6K tokens in descriptions
alone. A resource is fetched on demand, not injected automatically, so
this guidance exists without taxing every single call. The tradeoff: an
agent has to know to look for it. `b24_task_create`'s description points
here for exactly that reason — it's the natural first stop for anyone
about to build a task up.
