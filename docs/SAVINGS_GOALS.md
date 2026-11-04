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

## Picker and reservation feedback

The owner reported that Android WebView's actual goal deadline popup stayed blank
after an explicit light platform picker theme was added. The native-only
`-e picker_theme true` probe passed, but does not cover that WebView popup and
must not be used as its acceptance evidence. Goal deadlines now use AppDateInput,
a DOM calendar with fixed readable colors, month navigation, Bengali/English
labels, year entry and clear/cancel. It never creates a native date input; saved
values remain the same canonical YYYY-MM-DD string. The platform theme remains
for separate native dialogs, with its narrower probe coverage documented.

The `-e dom_calendar true` probe bundles the actual production AppDateInput into
a separate network-blocked WebView. It checks Bengali/English selection,
clear/cancel and the absence of native date inputs and automatic year-field focus.
Images draw that synthetic WebView only, excluding system and other-app overlays.
This isolates the component without reading the user's app DOM, storage or identity;
owner acceptance of the real goal form remains a separate check.

## Deleting an archived goal

Archived goals with no outstanding reservation can be deleted by typing exactly
`DELETE`. Both the form and storage method enforce that confirmation; Cancel
does not write anything. Deleted goals disappear from active/archive lists and
Home totals. Their previous wallet/journal history is retained unchanged.

Deletion is a durable, irreversible tombstone carried in its own isolated
`workspace.update` payload `{id, savingsDeletion: {version: 1, goalId}}`. This
keeps schema 5/protocol 1 and the original savingsEvent wire format unchanged.
Older savings apps retain this extra metadata without rejecting sync/backup;
they will only hide the goal after upgrading. Updated clients always let a
deletion dominate stale edits, restores and late offline allocations. Such
allocations remain in history but fund zero and cannot reserve wallet money.
Local deletion requires any currently known reservation to be released first.
Sync/hydration/backup validate owner, workspace, checksum and immutable conflicts;
the deletion/outbox commit is atomic and invalidates the cloud backup fingerprint.

The allocation form initially selects the first wallet with available money.
It shows actual balance, money already set aside across goals, and the remaining
available amount. Zero/negative balance, fully reserved balance, invalid amounts
and over-limit amounts explain the reason before Save and disable reservation.
The storage transaction still enforces the current available balance after sync;
a target or monthly plan never creates wallet money.
