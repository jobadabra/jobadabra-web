// Fictional mail fixtures preserve raw names, markup, codes and URLs without reaching accounts or delivery services.
export const RAW = '工程師 · Müller this Mac {count} <>&"';
export const URL = 'https://fictional.test/path?x=1&y=%7Bcount%7D';
/** Return fresh fictional data for every mail template; count and old-app branches are explicit fixture inputs. */
export function mailFixture(count = 2, appVersion = '0.9.99') {
  return {subject:RAW,text:RAW,html:'<b>Raw this Mac {count} &amp; literal</b>',buttons:[{text:RAW,url:URL},{text:'Second '+RAW,url:URL}],confirmUrl:URL,
    code:'482913 {code} <>&"',kind:'fixed',on:'2026-11-07',excerpt:RAW,message:RAW,matches:[{title:RAW,company:RAW,place:RAW,mode:RAW,fit:82,url:URL}],total:count,
    left:count,days:count,reason:'inactive',pricingUrl:URL,pro:9,proAi:19,version:'0.9.99',previousStable:'0.9.98',month:RAW,intro:RAW,
    sections:[{kind:'features',title:RAW,text:'Raw *emphasis* '+RAW,steps:[RAW]},{kind:'improvements',title:RAW,text:RAW},{kind:'fixes',title:RAW,text:RAW}],appVersion};
}
