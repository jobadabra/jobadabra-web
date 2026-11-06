# A lost employer list costs one restore

The owner asked on 5 Nov 2026: "What happened with the data loss? Can we track it down? Find root cause, and preven this happening again in the future?"
On 2 Nov the scout moved repos and lost its cache: feeds fell from 6,833 to 3,871 (43%, under the half-loss guard), feeds with kinds fell to 9, every publish was green, and no old copy existed on the site.

| PR | What | Proof |
|---|---|---|
| 1/2 | Each accepted publish keeps the day's list for 30 days, private to the site | `test/unit/api/employers.test.js` plays the loss and its restore |
| 2/2 | A publish keeping under 60% of employers is refused; a big drop of kinds alerts the owner, never blocks | `test/unit/api/employers.test.js` plays 2 Nov and a role_kinds.SINCE move |
| 3/3 | The line moves to 90% kept (owner, 6 Nov 2026: "Refuse a loss over 10% (Recommended)") | `test/unit/api/employers.test.js` 89 and 90 of 100 |

## Progress
- [x] 1/2 dated copies (#449, proof: test/unit/api/employers.test.js @c3e8f97)
- [x] 2/2 publish guard (#453, proof: test/unit/api/employers.test.js @e385a23)
- [x] 3/3 90% line (proof: test/unit/api/employers.test.js)
