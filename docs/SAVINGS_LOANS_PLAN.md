# Savings-backed business loans

Status: Android/Web forms, atomic wallet/loan accounting and foreground automatic
repayment implemented on 28 October 2026; synthetic validation passes. Physical
APK/real Drive owner acceptance and closed-app push/background execution pending.
Source: owner request in the existing development conversation. Tracked with
selected Notion items 41/43 (savings), 44 (debt), 45 (reminders), and 01/03
(notification delivery/inbox):
https://app.notion.com/p/403bf836a600815a8dcccec4ca26eda9

## Requested behavior

- Borrow money earmarked for a savings goal for a named business purpose.
- Select the source goal/wallet, borrowing business/wallet, principal and due date.
- Track principal lent, principal repaid, outstanding principal, accrued charges,
  remaining amount due and repayment history separately.
- Return repaid principal to the original savings wallet and reserve it for the
  original goal again. Borrowed money is shown as lent out, not funded savings.
- Send one logical reminder per loan per local calendar day starting seven days
  before its due date. Stop future reminders once fully repaid. Android and Web
  delivery, permission/offline handling and notification history are dependencies.
- Automatically repay from the designated borrowing wallet when due if the
  configured funds rule is satisfied; do not take money from unrelated wallets
  or other goals' reservations.
- When funds are insufficient, track the unpaid amount and apply only the
  interest/late-charge policy explicitly selected for that loan.

## Confirmed owner decisions

1. Automatic repayment means an app-wallet ledger transfer, not a bank/bKash debit.
2. Charge monthly simple interest on outstanding principal. The owner sets the
   rate per loan. Unpaid interest never becomes principal; no compounding.
3. Repay the available spendable amount partially; leave the rest outstanding.
   Other goals' reservations and unrelated wallets must not be used.

## Confirmed calculation and delivery policy

- Owner selected monthly rate/30 for each late day on unpaid principal. The app
  persists daily-30; the engine's alternative completed-month basis is not offered.
- Owner selected reminders at 19:00 Asia/Dhaka and confirmed Firebase is not yet
  created. Actual push delivery is pending; see FIREBASE_NOTIFICATIONS_SETUP.md.
- Repayment allocation order (principal-first or interest-first) is an explicit
  required term, displayed in the loan form. Principal-first is visibly preselected
  and can be changed before recording a loan; no hidden allocation order.
- The calculation accrues only after the due date, before repayments
  on their effective local date, and carries fractional paisa between segments,
  rounding down to whole paisa. The form explains these rules.
  The engine has no grace-period or extra-fee assumption and never invents a rate.

## Implemented independent foundation

`src/domain/savingsLoans.ts` supplies pure calculations used by storage and UI:

- Strict immutable terms/payment schemas, integer-paisa/BigInt calculation,
  principal/interest separation and chronological replay.
- Monthly simple interest with explicit daily-30 or completed-month basis;
  month-end/leap-year handling and reduced principal after partial repayments.
- Payment-ID deduplication; changed-ID payload conflicts, foreign loan references
  and overpayment are rejected rather than silently changing the ledger.
- Due-date partial-repayment proposals capped by provided spendable funds. IDs
  include owner, loan, date and committed payment history. Identical snapshot
  retries use one ID; new money permits another same-day partial repayment.
- Daily reminder proposals from seven days before due, continuing while unpaid;
  chosen timezone/time, stable IDs and paid-loan cancellation. A proposal is not
  a sent notification. A stable ID alone is not distributed exactly-once execution.

`src/storage/loanBook.ts` commits principal cash movement, linked workspace-local
balanced receivable/payable journals, source reservation releases, immutable loan
metadata and outbox atomically. Principal returns to the original goal; paid
interest uses separate income/expense journals and remains cash available to plan.
Internal loan ledger accounts are archived/non-spendable and hidden from wallets.
Goal archive/delete is blocked while debt remains. Loan journals cannot be edited
or reversed through ordinary transaction controls. Schema 5/protocol 1 retained.

`SavingsLoansModal` opens from Savings goals, supports Bengali amounts, the DOM
calendar, rate/order/automatic setting, manual partial/full repayment and history.
The creating device executes repayments; other devices can view synced loans.
This deliberately prevents two replicas automatically debiting the same loan.
Device-loss/executor reassignment needs a separate coordinated recovery workflow.

`runForegroundLoanRepayments` runs only after verified Drive sync on the original
device and a matching fresh owner receipt. Each loan has an explicit automatic
setting in its form (preselected on, can be turned off before creation). The form
states execution starts at 19:00 Asia/Dhaka on the due date. Overdue loans may
repay at later syncs when more available money arrives. Every payment rechecks
current debt, spendable funds and goal status inside its transaction. Unrelated
goals stay reserved. Stale/no sync, wrong owner/device and missing references do
not auto-pay. This is eventual offline accounting, not a global bank balance lock.

20 focused loan tests and 238 total tests passed before the final automation-stop
control. The additional stop/concurrency/restore test passes; final build checks
are recorded with the APK delivery. Browser/API type checks and Web
build pass. A 390px Bengali synthetic UI test created a 2,000 BDT loan, repaid
1,000 BDT, retained the other goal and verified zero pending links/four balanced
journals. Evidence: build/loans-integrated-final-tests.log and
build/savings-loan-mobile.jpg. Real user financial records were not modified.

Closed-app Android/Web push and closed-app settlement are NOT enabled by this
foreground worker. Firebase delivery is a separate dependency and does not gain
financial write authority. The app states the limitation rather than reporting
unsent notifications or unsaved payments as successful.

Automation can be stopped from any owner device and re-enabled only on the
executor. A new stop beats stale enables regardless of timestamp or revision;
re-enabling must acknowledge every observed stop. The automatic payment's own
transaction rechecks the active setting, due clock and fresh sync receipt, so a
proposal calculated before a successful stop cannot debit afterward. Stopping
does not reverse payments already committed. Stops on another offline device
reach the executor through sync; they are not an instantaneous remote bank lock.

## Safety contract and remaining release checks

- Current savings are reservations over wallet balances, not a separate ledger
  account. Loan issuance must link the reservation reduction, money movement,
  outstanding loan and durable sync operation atomically; cancellation/failure
  must not lose the reservation or create half a loan.
- Existing transfer journals are scoped to one workspace. Personal-to-business
  cross-workspace loans require explicit linked, balanced entries in both
  workspaces with same-owner validation, atomic commit and consolidation rules.
  Never insert an account from another workspace into an ordinary transfer.
- Principal movement must not inflate income/expense or consolidated assets.
  Interest/fees are distinct from principal; the ledger mapping and any internal
  cross-workspace consolidation must be designed before posting.
- A reminder does not prove a payment occurred. Mark repayment successful only
  after the authoritative ledger commit (and provider confirmation if external
  payments are subsequently selected and supported).
- Local JS and current foreground Drive sync cannot promise execution with both
  apps closed. Background scheduling/delivery and coordinated financial execution
  require separate implementation and explicit configuration. Do not silently
  replace the current financial authority with a server copy.
- Automatic financial jobs need durable operation identities, current authorized
  balances, coordinated execution, atomic journal/loan/outbox writes and retry
  reconciliation. Stale snapshots or independent phone/Web timers must not each
  debit the same loan. Offline overdue work stays visibly pending until safe.
- Use integer paisa and deterministic charge periods. Due-date edits, timezone
  changes, repeated jobs, repayments and interest retries must not double-charge.
- A goal with outstanding loan principal cannot be permanently deleted without
  an explicit history-preserving settlement rule. Existing goal history,
  wallet protection, private owner binding and backup validation must be retained.

## Acceptance work before release

- Owner decisions resolved; forms implemented; physical EN/BN acceptance pending.
- Issue, partial/full/manual/automatic repayment and return-to-goal scenarios.
- Separate borrowed versus funded goal progress, wallet availability and reports.
- Same/cross-workspace ownership, insufficient balance, other-goal protection.
- Seven-day reminder boundaries, chosen timezone, paid-loan cancellation,
  permission denial, offline delivery and duplicate-job reconciliation.
- Late-charge boundaries, partial repayments and repeated-run/rounding tests.
- Two-device/offline concurrency, atomic rollback, restart, sync and backup restore.
- Synthetic data first; no existing customer records changed. No bank debit,
  extra fee, paid resource or actual notification send activated. APK/preview
  delivery is recorded separately in the canonical Notion tracker.
