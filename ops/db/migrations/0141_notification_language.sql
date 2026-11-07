-- Derived delivery-language cache of the authoritative desktop appearance preference; old and unknown accounts keep English.
ALTER TABLE pro_accounts ADD COLUMN notification_language TEXT NOT NULL DEFAULT 'en'
  CHECK (notification_language IN ('en', 'de', 'fr', 'it', 'es', 'ro', 'ru'));
