# Free Preview infrastructure proposal — 29 October 2026

The owner approved Neon Free PostgreSQL and Private Vercel Blob provisioning
on 29 October 2026 for `hisab-dekhtechai-app` Preview only, with synthetic data
first. This does not authorize a paid plan, Production access or uploads of
real financial records. Provisioning results are recorded in the Notion tracker.
The only initially approved administrator is ainulshalkhuria@gmail.com.
Server-verified Google identity and verified email are required for that role.

| Purpose | Proposed service | Published free allowance |
| --- | --- | --- |
| Vendor-independent PostgreSQL | Neon Free | $0, no credit card; 1 GB per project, 100 CU-hours/month/project. Idle compute sleeps. Restore history: up to six hours or 1 GB changes. |
| Private attachments and encrypted snapshots | Vercel Blob Private, Preview only | Hobby: 1 GB/month, 10,000 simple and 2,000 advanced operations, 10 GB Blob transfer. Function/CDN limits also apply. Exceeded limits can suspend access. |
| Independent recovery copy | Existing owner Drive plus downloaded backups | Preserve current functionality. Not a claim that a new central database already has automatic offsite disaster recovery. |

Vercel Hobby permits non-commercial personal use only. A commercial customer
launch requires appropriate hosting terms/plan and a separately approved
budget. No free commercial production or unlimited customer count is promised.
Neon also advertises object storage; availability, regions and private access
must be confirmed before choosing it instead of the independent Blob provider.

## Approved Preview setup and remaining activation gates

1. Create Neon Free project; choose region after availability/latency
   checks. Separate Preview database/role; standard PostgreSQL and Node adapters.
2. Private Blob store linked only to Preview. No public financial objects or
   secrets in chat, Notion, client, APK or repository.
3. Exercise synthetic tenant isolation, quota failures, upload read-back and
   isolated recovery before accepting any owner data.
4. Separate explicit per-owner opt-in; central copy starts disabled as a mirror.
   Personal local/Drive authority remains intact.
5. Proposed application limits: 40 MB per encrypted snapshot, bounded version
   retention and per-owner quota. Keep the last verified copy until its
   replacement passes verification. Review key recovery and retention before
   activation; do not claim Google-only recovery provides genuine E2EE.
6. Employee sharing needs its own coordinator: verified Google subject, owner
   invitation and recipient acceptance, wallet/role scopes, audit, revocation
   and idempotent balanced writes. Hashing an email is not verification.
   Explicit migration acceptance precedes any shared financial authority.

The immediate $0 option remains local storage, private Drive and downloaded
backups. Push Redis remains bounded notification metadata, never a ledger.

Official sources checked 29 October 2026:
- https://neon.com/pricing
- https://vercel.com/docs/vercel-blob/usage-and-pricing
- https://vercel.com/docs/vercel-blob/private-storage
- https://vercel.com/docs/plans/hobby
