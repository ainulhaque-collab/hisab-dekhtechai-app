# Savings goals and emergency funds

Notion selected scope 41/43. The Home savings card opens a bilingual goal manager:
create/edit a target, optional deadline and monthly plan, reserve existing wallet
money, release reservations, inspect contribution history, archive and restore.
Emergency targets equal the user's essential monthly expenses multiplied by their
chosen 1–24 months. Coverage and progress use funded money only.

## Accounting and offline behavior

A reservation never creates a journal, transfer, income, expense or bank deposit.
All arithmetic uses integer paisa. A new reservation must fit the current wallet's
available balance after every goal's funded reservation. Archived wallets keep
their previous reservations but cannot accept new ones.

Offline devices can independently reserve the same money. After merging,
funding is recomputed deterministically in contribution timestamp/operation-ID
order, capped per asset account at its positive real balance. Requested amounts,
funded amounts and uncovered shortfalls remain distinct. Spending can therefore
reduce funded progress; a reversal can restore it. Missing legacy-deleted wallets
fund zero. The UI never calls uncovered reservations saved money.

Releases reference specific immutable contributions. Concurrent releases are
capped at that contribution's amount and cannot consume later contributions.
Incomplete matching sync records are retained, shown as pending, and block new
reservations until related records arrive. Goal metadata uses logical revisions
and operation-ID tie-breaking; contributions do not use last-writer-wins merging.
Archiving requires zero outstanding requested allocation locally. Histories remain.

## Persistence and compatibility

Schema 5, database keys and sync protocol 1 remain unchanged. Isolated
`workspace.update` payloads contain only `id` and a versioned `savingsEvent`.
Older clients ignore that metadata extension while retaining its full immutable
operation in their existing sync/backup history. New clients reconstruct the
projection from those records. There is no second mutable financial authority.

Owner/workspace/account references, input bounds and immutable collisions are
validated on fresh sync, durable hydration and backup import. Local intent and
outbox writes share the existing database transaction. Account and workspace
deletion guards preserve savings history. Goal-only changes affect the verified
cloud-backup fingerprint; datasets without goals keep their previous fingerprint.

## Validation

Domain and storage tests cover exact money, concurrent allocations/releases,
reordered replay, metadata revisions, rollback, foreign references, legacy
hydration, owner binding, backup integrity, deletion and spending/reversal behavior.
An isolated synthetic browser fixture checks Bengali numeric input, goal creation,
reservation/release and emergency target math at a 390-pixel phone width.

Actual Android/Web goal sync and owner visual acceptance remain separate checks.
Monthly calculations divide remaining target across the current through deadline
calendar months; they are a plan, not automatic transfers or investment returns.
