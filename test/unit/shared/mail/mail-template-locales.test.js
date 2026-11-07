// End-user template fixtures pin English bytes, explicit seven-language rendering and raw-data/markup boundaries without delivery.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import {TEMPLATES} from '../../../../shared/mail-templates.js';
import {footerOf} from '../../../../shared/mail-footer.js';
import {frameHtml,frameText} from '../../../../shared/mail-frame.js';
import {NOTIFICATION_LANGUAGES} from '../../../../shared/notification-language.js';
import {ENGLISH_BASELINES} from './mail-english-baseline.js';
import {mailFixture,RAW,URL} from './mail-locale-fixtures.js';
const IDS=['message','welcome','confirm-resend','feedback-update','account-code','digest','trial-left','trial-ending','always-on-paused','always-on-test','pro-launch','release'];
function parts(name,data,locale) {
  const spec=TEMPLATES[name],given={...data,...(locale?{locale}:{})};
  const options={title:spec.title(given),body:spec.html(given),button:spec.button?.(given)||null,why:footerOf(name,'fallback',locale).why,links:{stop:'https://fictional.test/stop',settings:'https://fictional.test/settings'},trust:true,download:true,...(locale?{locale}:{})};
  return{subject:spec.subject(given),title:spec.title(given),text:spec.text(given),html:spec.html(given),button:options.button,footer:footerOf(name,'fallback',locale),frameHtml:frameHtml(options),frameText:frameText({...options,body:spec.text(given)})};
}
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
test('all twelve templates retain frozen default English bytes across counts and app versions',()=>{
  assert.deepEqual(Object.keys(TEMPLATES).sort(),IDS.slice().sort());assert.equal(Object.keys(ENGLISH_BASELINES).length,120);
  for(const name of IDS)for(const count of [0,1,2,5,20])for(const version of ['0.9.6','0.9.99']){
    const data=mailFixture(count,version),expected=ENGLISH_BASELINES[name+':'+count+':'+version];
    assert.equal(hash(parts(name,data)),expected,name+':'+count+':'+version);
    assert.equal(hash(parts(name,data,'en')),expected,name+' explicit English');
    for(const locale of ['system','unknown','<script>'])assert.equal(hash(parts(name,data,locale)),expected,name+' fallback '+locale);
  }
});
test('all twelve actual components render independently in all seven languages',async()=>{
  for(const name of IDS)for(const count of [0,1,2,5,20]){
    const data=mailFixture(count),en=parts(name,data,'en');
    const rendered=await Promise.all(NOTIFICATION_LANGUAGES.map(async locale=>({locale,value:parts(name,data,locale)})));
    for(const {locale,value} of rendered){
      assert.ok(value.frameHtml.includes('lang="'+locale+'"'),name+' '+locale+' HTML language');
      assert.ok(!JSON.stringify(value).includes('mailCopy.'),'never expose a missing key');
      if(locale!=='en')assert.notEqual(value.frameText,en.frameText,name+' '+locale+' authored text');
      assert.deepEqual([...value.frameHtml.matchAll(/href="([^"]*)"/g)].map(match=>match[1]),[...en.frameHtml.matchAll(/href="([^"]*)"/g)].map(match=>match[1]),name+' '+locale+' URLs');
    }
  }
  assert.equal(TEMPLATES.welcome.subject({locale:'de'}),'Bestätige deine E-Mail-Adresse für Jobadabra');
});
test('raw subjects, job values, codes and release prose are not translated or interpolated again',()=>{
  for(const locale of NOTIFICATION_LANGUAGES){
    const data=mailFixture();assert.equal(TEMPLATES.message.subject({...data,locale}),RAW);assert.ok(TEMPLATES.message.text({...data,locale}).startsWith(RAW));assert.ok(TEMPLATES.message.html({...data,locale}).startsWith(data.html));
    for(const name of ['message','feedback-update','digest','release']){const value=parts(name,data,locale);assert.ok(value.text.includes(RAW),name+' raw text');assert.ok(value.html.includes('this Mac {count}'),name+' raw placeholders');assert.ok(!value.html.includes('Müller this Mac {count} <>&"'),name+' HTML escapes raw names');}
    const code=parts('account-code',data,locale);assert.ok(code.text.includes(data.code));assert.ok(code.html.includes('482913 {code} &lt;&gt;&amp;&quot;'));
    assert.ok(parts('digest',data,locale).html.includes(URL.replaceAll('&','&amp;')));
  }
});
test('catalogs have complete key/placeholder/plural parity and no global active locale',async()=>{
  const {catalogs,mailText}=await import('../../../../shared/mail-copy.js');
  const params=value=>[...new Set((typeof value==='string'?[value]:Object.values(value)).flatMap(text=>[...text.matchAll(/\{(\w+)\}/g)].map(match=>match[1])))].sort();
  for(const locale of NOTIFICATION_LANGUAGES){assert.deepEqual(Object.keys(catalogs[locale]).sort(),Object.keys(catalogs.en).sort(),locale);
    for(const [key,value] of Object.entries(catalogs[locale])){assert.deepEqual(params(value),params(catalogs.en[key]),locale+'.'+key);if(typeof value==='object')for(const form of new Intl.PluralRules(locale).resolvedOptions().pluralCategories)assert.ok(value[form],locale+'.'+key+'.'+form);}
    for(const count of [0,1,2,5,20,1000000])for(const key of ['feedbackThanks','heldDigestSubject','digestSubject','digestTitle','trialLeft','trialOpening','trialEndingSubject','trialEndingBody','creditApprox']){
      const values=catalogs[locale][key],form=new Intl.PluralRules(locale).select(count);assert.equal(mailText(locale,key,{count,number:count}),values[form].replaceAll('{count}',String(count)).replaceAll('{number}',String(count)));
    }
  }
  assert.notEqual(mailText('ru','welcomeTitle'),mailText('de','welcomeTitle'));assert.equal(mailText('unknown','welcomeTitle'),catalogs.en.welcomeTitle);
});
test('optional test data and every pause/feedback/release/update branch use the same explicit locale',async()=>{
  const {mailText}=await import('../../../../shared/mail-copy.js');
  for(const spec of Object.values(TEMPLATES))for(const field of ['subject','title','text','html','button'])if(spec[field])assert.doesNotThrow(()=>spec[field]());
  for(const locale of NOTIFICATION_LANGUAGES){const data=mailFixture();
    assert.equal(TEMPLATES['feedback-update'].title({...data,kind:'deferred',locale}),mailText(locale,'feedbackThanksTitle'));
    const paused=TEMPLATES['always-on-paused'];assert.equal(paused.subject({...data,reason:'trial-over',locale}),mailText(locale,'pausedSubjectExpired'));assert.equal(paused.title({...data,reason:'trial-over',locale}),mailText(locale,'pausedTitleExpired'));assert.equal(paused.text({...data,reason:'trial-over',locale}),mailText(locale,'pausedBodyExpired'));assert.equal(paused.button({...data,reason:'trial-over',pro:true,locale}).label,mailText(locale,'keepRunning'));assert.equal(paused.button({...data,reason:'trial-over',pro:false,locale}),null);
    const release=parts('release',{...data,test:true},locale);assert.ok(release.text.includes(mailText(locale,'releaseTest',{version:data.version})));assert.ok(release.subject.startsWith('[TEST] '));assert.ok(release.text.includes(mailText(locale,'changesSince',{version:data.previousStable})),locale+' plain-text previous-version label');
    for(const name of ['digest','release'])assert.ok(parts(name,mailFixture(2,'0.9.6'),locale).frameText.includes(mailText(locale,'updateJobadabra')));
    assert.equal(TEMPLATES.message.button({locale}),null);assert.ok(!TEMPLATES.message.html({...data,confirmUrl:'',locale}).includes(mailText(locale,'confirmAction')));
  }
});
