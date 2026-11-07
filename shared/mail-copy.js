// Format bundled end-user mail copy per recipient without active process language or transport side effects.
import {notificationText} from './notification-language.js';
import {messages as en} from './catalogs/mail/en.js';
import {messages as de} from './catalogs/mail/de.js';
import {messages as fr} from './catalogs/mail/fr.js';
import {messages as it} from './catalogs/mail/it.js';
import {messages as es} from './catalogs/mail/es.js';
import {messages as ro} from './catalogs/mail/ro.js';
import {messages as ru} from './catalogs/mail/ru.js';
/** The complete bundled mail catalogs for the seven supported recipient languages. */
export const catalogs = Object.freeze({en,de,fr,it,es,ro,ru});
/** Resolve trusted mail copy with explicit locale and named values; unknown language uses English. */
export function mailText(locale,key,variables={}) { return notificationText(locale,catalogs,key,variables); }
