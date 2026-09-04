# Planning Documents

The files in this directory preserve product and engineering thinking beyond
the immediate implementation slice.

## Source-of-truth policy

- **Planning documents own planning:** rationale, product law, alternatives,
  durable acceptance, dependency order, proof gates, and next/later horizons.
- **GitHub Issues own immediate work:** one bounded executable slice, its current
  acceptance checklist, assignee, dependencies, and delivery status.
- An issue link in a planning document is historical context unless the text
  explicitly identifies it as the currently promoted slice.
- Do not keep future design alive as a parked or blocked issue. Close it into
  the relevant planning section and promote a new or reopened bounded issue only
  when the prerequisite and priority decision are real.
- Closing a design issue does not mean the proposal shipped. The planning
  document must say whether a result is shipped, accepted but unshipped, or only
  proposed.

## Status vocabulary

| Label          | Meaning                                                                                |
| -------------- | -------------------------------------------------------------------------------------- |
| **Shipped**    | The behavior exists in the runtime/content, replays, and has executable evidence.      |
| **Accepted**   | Product or compatibility law is normative, but some behavior may remain unimplemented. |
| **Planning**   | A durable candidate sequence or design that has not been activated.                    |
| **Historical** | Prior issue/decision evidence retained to explain why the current contract exists.     |

Avoid `open`, `blocked`, `ready`, milestones, assignees, and live priority labels
in these files. Those facts change in GitHub. A planning priority may describe
dependency or product importance, but it must not imply that the work is active.

## Grooming rule

When immediate work lands:

1. close its GitHub issue;
2. update the canonical product/system documentation with shipped truth;
3. update the relevant planning status or remove the resolved gap; and
4. promote only the next smallest justified slice.

The current product proof sequence is
[Seventh-Visit Product Proof Plan](seventh-visit-operating-queue.md). The
construction/living-world sequence is
[Construction, Place Development, and Route Discovery](../worldpacks/construction-and-routing-discovery.md).

[Runtime Maintenance](runtime-maintenance.md) preserves the extraction sequence
and connection reuse proposals until the product proof makes room for them.
