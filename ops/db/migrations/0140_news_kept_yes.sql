-- What's new is off until a yes (owner, 6 Nov 2026). Someone who already answered about news saw it ticked and left it, so that stays a yes.
-- Nobody else gets a row, and a stop stays a stop. If this fails, site.yml only warns, and those people get less mail, never more.
INSERT OR IGNORE INTO mail_on (addr, list, via, at)
  SELECT addr, 'releases', 'kept', at FROM (
    SELECT addr, at FROM mail_on WHERE list = 'tips'
    UNION
    SELECT addr, at FROM mail_off WHERE list = 'tips'
  )
  WHERE addr NOT IN (SELECT addr FROM mail_off WHERE list IN ('releases', 'marketing'));
