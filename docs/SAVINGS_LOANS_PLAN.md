# Savings-backed business loans

Status: owner decisions captured and pure calculation/planning engine implemented
on 28 October 2026. Not integrated with app wallets or enabled for real money.
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

## Remaining policy/configuration

- An owner question is pending about incomplete months: accrue monthly rate/30
  for each late day, or charge on each completed calendar-month anniversary.
  The pure engine supports both explicitly; no live default is selected.
- Daily reminder time in Asia/Dhaka and the Firebase project identity are pending.
- Repayment allocation order (principal-first or interest-first) is an explicit
  required engine term. It must be displayed and selected in the future loan form;
  tests of either option do not select a policy on the owner's behalf.
- The proposed calculation accrues only after the due date, before repayments
  on their effective local date, and carries fractional paisa between segments,
  rounding down to whole paisa. These rules must be shown in the loan preview.
  The engine has no grace-period or extra-fee assumption and never invents a rate.

## Implemented independent foundation

`src/domain/savingsLoans.ts` is pure, detached from production storage and UI:

- Strict immutable terms/payment schemas, integer-paisa/BigInt calculation,
  principal/interest separation and chronological replay.
- Monthly simple interest with explicit daily-30 or completed-month basis;
  month-end/leap-year handling and reduced principal after partial repayments.
- Payment-ID deduplication; changed-ID payload conflicts, foreign loan references
  and overpayment are rejected rather than silently changing the ledger.
- Due-date partial-repayment proposals capped by provided spendable funds, stable
  owner/loan/local-day IDs, and no proposal before due or after settlement.
- Daily reminder proposals from seven days before due, continuing while unpaid;
  chosen timezone/time, stable IDs and paid-loan cancellation. A proposal is not
  a sent notification. A stable ID alone is not distributed exactly-once execution.

`src/test/savings_loans.test.ts`: 10 focused tests pass for these calculations,
boundaries and validation. They use synthetic records and never touch app data.
The wallet commit, cross-workspace accounting, UI, coordinated execution and push
transport below remain unimplemented; the installed signed v15 is unchanged.

## Implementation constraints to resolve

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

- Owner decisions resolved; accessible Bengali/English borrow/repay forms.
- Issue, partial/full/manual/automatic repayment and return-to-goal scenarios.
- Separate borrowed versus funded goal progress, wallet availability and reports.
- Same/cross-workspace ownership, insufficient balance, other-goal protection.
- Seven-day reminder boundaries, chosen timezone, paid-loan cancellation,
  permission denial, offline delivery and duplicate-job reconciliation.
- Late-charge boundaries, partial repayments and repeated-run/rounding tests.
- Two-device/offline concurrency, atomic rollback, restart, sync and backup restore.
- Synthetic data first; no existing customer records or installed features changed
  by this requirements document. No bank debit, fee, paid resource, notification
  send, APK release or deployment is activated by this plan.
