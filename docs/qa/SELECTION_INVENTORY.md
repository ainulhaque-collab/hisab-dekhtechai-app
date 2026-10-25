# Selection control inventory

All 17 previous native HTML select controls now use AppSelect. No native select remains in src/components.

| Screen | Controls | Implementation |
|---|---|---|
| Add Account | Account Type; Assign Account Group | AppSelect |
| Edit Account | Account Type; Account Group | AppSelect |
| Add Transaction | Main Category; Sub-category; Associated Person; New Person Role | AppSelect |
| History | Person filter; Account filter; Category filter; Edit Account; Edit Category; Edit Person | AppSelect |
| Reports | Budget Category; Recurring Frequency | AppSelect |
| People | Person Role / Relationship | AppSelect |
| Add Transaction | From Account / Wallet; To Account / Wallet | Existing AccountPickerModal upgraded with portal, focus trap and native Back dismissal |
| Header | Workspace switcher; Manage Workspaces entry | Existing DOM menu plus WorkspaceManager |

Other inspected selection UI: transaction type tabs, report/filter tabs, language tabs, workspace kind radio buttons, sharing-role radio buttons, sound/haptic/PIN switches and multi-account permission checkboxes. Ordinary boolean controls were retained.

Shared acceptance: explicit readable colors; exact IDs; disabled option handling; 85dvh scroll containment; search above six options; empty result; Bengali/English labels; Cancel/outside/Escape; focus restoration and trapped Tab; top-dialog native Android Back; portals prevent clipping by transformed parent modals. Native device acceptance remains blocked and must not be reported as verified from these checks.
