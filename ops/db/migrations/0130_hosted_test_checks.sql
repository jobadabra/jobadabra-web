-- Hosted Always on, the 10-second Test (owner, 5 Nov 2026: "a test shuold not take more than 10 seconds"): what the site saw of a run's first seconds.
ALTER TABLE hosted_runs ADD COLUMN read_at TEXT;    -- the container's first read of the person's profile with the run token (api/hosted-state.js config)
ALTER TABLE hosted_runs ADD COLUMN ai_at TEXT;      -- a Test press: the AI answered one short call made with the run token (api/hosted-test.js)
ALTER TABLE hosted_runs ADD COLUMN ai_error TEXT;   -- or what the AI answered instead
