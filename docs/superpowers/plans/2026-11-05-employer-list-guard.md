# A lost employer list costs one restore

The owner asked on 5 Nov 2026: "What happened with the data loss? Can we track it down? Find root cause, and preven this happening again in the future?"
On 2 Nov the scout moved repos and lost its cache: feeds fell from 6,833 to 3,871 (43%, under the half-loss guard), feeds with kinds fell to 9, every publish was green, and no old copy existed on the site.

| PR | What | Proof |
|---|---|---|
| 1/2 | Each accepted publish keeps the day's list for 30 days, private to the site | `test/unit/api/employers.test.js` plays the loss and its restore |
| 2/2 | A publish that loses most employer kinds is refused, and the owner is told | `test/unit/api/employers.test.js` plays the kinds falling to 9 |

## Progress
- [ ] 1/2 dated copies
- [ ] 2/2 publish guard
