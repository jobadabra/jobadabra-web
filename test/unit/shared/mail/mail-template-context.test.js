// Real composition and fake-provider delivery pin end-user locale versus operational English without accounts or outbound calls.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {compose,send} from '../../../../shared/mail.js';
import {TEMPLATES} from '../../../../shared/mail-templates.js';
import {footerOf} from '../../../../shared/mail-footer.js';
import {mailText} from '../../../../shared/mail-copy.js';
import {createAccount} from '../../../../shared/pro.js';
import {NOTIFICATION_LANGUAGES} from '../../../../shared/notification-language.js';
import {purchaseCreditWords} from '../../../../shared/credit-purchase-words.js';
import {CREDIT} from '../../../../shared/pro-packages.js';
import {applicationsFor} from '../../../../desktop/renderer/credit-buys.js';
import {mailFixture,RAW} from './mail-locale-fixtures.js';
const links={stop:'https://fictional.test/stop?token=raw%7Bcount%7D',settings:'https://fictional.test/settings'};
function rig(t) {
  const trips=[],sent=[],db=new DatabaseSync(':memory:');
  for(const file of ['0015_ai_calls.sql','0079_pro.sql','0082_pro_trial.sql','0083_mail.sql','0135_mail_on.sql','0141_notification_language.sql'])db.exec(readFileSync(new URL('../../../../db/migrations/'+file,import.meta.url),'utf8'));
  const statement=(sql,args=[])=>({bind:(...values)=>statement(sql,values),run:async()=>db.prepare(sql).run(...args),all:async()=>({results:db.prepare(sql).all(...args)}),first:async()=>db.prepare(sql).get(...args)??null});
  t.mock.method(globalThis,'fetch',(...args)=>{trips.push(args);throw Error('No external service allowed');});
  t.after(()=>{assert.deepEqual(trips,[],'caught send errors cannot hide real transport access');db.close();});
  return{sent,db,env:{MAIL:'on',STATS:{db,prepare:sql=>statement(sql)},STATS_SALT:'fictional-salt',EMAIL:{send:async value=>{sent.push(value);return{messageId:'fake-'+sent.length};}}}};
}
test('actual compose requires explicit recipient locale, defaults English and keeps headers/URLs for all12×7',t=>{
  rig(t);for(const name of Object.keys(TEMPLATES)){
    const data=mailFixture(),english=compose(name,data,links);
    for(const locale of NOTIFICATION_LANGUAGES){
      assert.deepEqual(compose(name,{...data,locale},links),english,name+' untrusted payload locale');
      const current=compose(name,data,links,locale);assert.ok(current.html.includes('lang="'+locale+'"'));assert.deepEqual(current.headers,english.headers);
      assert.deepEqual([...current.html.matchAll(/href="([^"]*)"/g)].map(match=>match[1]),[...english.html.matchAll(/href="([^"]*)"/g)].map(match=>match[1]));
      if(locale!=='en')assert.notEqual(current.text,english.text,name+' translated authored text');
    }
    for(const locale of ['system','unsupported','<script>'])assert.deepEqual(compose(name,data,links,locale),english,name+' unsupported fallback');
  }
});
test('real fake-provider send localizes user Test but ownerTest stays English with same recipient',async t=>{
  const {env,sent,db}=rig(t),email='fictional@example.test';await createAccount(env,email);db.prepare('UPDATE pro_accounts SET notification_language = ?').run('ru');
  assert.equal((await send(env,'always-on-test',email,{}, {test:true})).ok,true);assert.equal(sent.at(-1).subject,mailText('ru','testSubject'));assert.ok(sent.at(-1).html.includes('lang="ru"'));
  assert.equal((await send(env,'always-on-test',email,{locale:'ru'}, {test:true,ownerTest:true,locale:'de'})).ok,true);assert.equal(sent.at(-1).subject,mailText('en','testSubject'));assert.ok(sent.at(-1).html.includes('lang="en"'));
  assert.equal((await send(env,'always-on-test',email,{}, {test:true,locale:'fr'})).ok,true);assert.equal(sent.at(-1).subject,mailText('fr','testSubject'));assert.equal(db.prepare('SELECT notification_language AS value FROM pro_accounts').get().value,'ru');
  assert.ok(sent.every(value=>value.to===email));assert.equal(sent.length,3);
});
test('typed footer defaults localize, arbitrary fallback and policy flags do not change',t=>{
  rig(t);for(const locale of NOTIFICATION_LANGUAGES){
    assert.equal(footerOf('trial-left',RAW,locale).why,RAW);assert.equal(footerOf('trial-left',RAW,locale,'frameReply').why,RAW);
    for(const key of ['footerService','footerJobDigest','footerReleases','footerTips'])assert.equal(footerOf('trial-left',RAW,locale,key).why,mailText(locale,key));
    for(const name of Object.keys(TEMPLATES)){const {why,...current}=footerOf(name,RAW,locale);const {why:unused,...english}=footerOf(name,RAW);assert.deepEqual(current,english,name+' footer flags');}
  }
});
test('credit copy uses only the existing measured numeric result and keeps no-credit purchases empty',t=>{
  rig(t);for(const locale of NOTIFICATION_LANGUAGES){
    for(const [kind,micro] of Object.entries(CREDIT)){const words=purchaseCreditWords(kind,locale);if(!micro){assert.equal(words,'');continue;}
      assert.ok(words.includes(String(micro/1e6)));assert.ok(words.includes(String(applicationsFor(micro/1e6))));if(locale!=='en')assert.notEqual(words,purchaseCreditWords(kind));
    }
    assert.equal(purchaseCreditWords('unknown',locale),'');
  }
});
test('template transport policy metadata remains canonical',()=>{
  const extra={'confirm-resend':{essential:true},'account-code':{essential:true},'feedback-update':{heldByStops:true},'always-on-test':{heldByStops:true},'pro-launch':{waitlistToo:true}};
  for(const [name,spec] of Object.entries(TEMPLATES)){const {subject,title,button,text,html,...policy}=spec;assert.deepEqual(policy,{list:name==='release'?'releases':name==='pro-launch'?'tips':'service',...extra[name]},name);}
});
