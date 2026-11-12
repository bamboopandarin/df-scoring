import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('singles and doubles photo buttons play the selected full player profile only for this match referee',()=>{
 const played=[];let buttons=[];
 const avatars={innerHTML:'',querySelectorAll(){buttons=Array.from(this.innerHTML.matchAll(/data-slogan-team="([^"]+)" data-slogan-index="(\d+)"/g),m=>({dataset:{sloganTeam:m[1],sloganIndex:m[2]}}));return buttons;}};
 const context=vm.createContext({document:{addEventListener(){},getElementById:id=>id==='score-avatars-a'?avatars:null},localStorage:{getItem:()=>null},window:{soundEngine:{playPlayerSloganNow:p=>played.push(p)}},console});
 vm.runInContext(readFileSync(new URL('../static/js/app.js',import.meta.url),'utf8'),context);
 vm.runInContext(`AppState.currentUser={id:'ref',role:'member'};
 AppState.refereeMatches=[{tournament_id:'t',fixture_id:'first'}];
 AppState.courts=[{id:AppState.currentCourtId,active_match:{tournament_id:'t',tournament_match_id:'first'}}];
 AppState.players=[{id:'a1',name:'First',slogan_audio_url:'/first.webm'},{id:'a2',name:'Second',slogan_text:'Second slogan'}];
 AppState.scorer={team_a:{name:'Team',players:[{id:'a1',name:'First'},{id:'a2',name:'Second'}]}};
 renderTeamScoreHeader('a',AppState.scorer.team_a,false,true,0,true);`,context);
 assert.equal(buttons.length,2);buttons[1].onclick();assert.equal(played[0].slogan_text,'Second slogan');
 vm.runInContext(`AppState.refereeMatches=[{tournament_id:'t',fixture_id:'other'}];`,context);
 buttons[0].onclick();assert.equal(played.length,1,'grant for another match cannot play slogan');
 vm.runInContext(`AppState.currentUser.role='admin';renderTeamScoreHeader('a',AppState.scorer.team_a,false,false,0,true);`,context);
 assert.equal(buttons.length,1);buttons[0].onclick();assert.equal(played[1].slogan_audio_url,'/first.webm');
});

test('a deliberate photo tap starts audio immediately while preserving muted automatic announcements',()=>{
 const played=[];
 class Audio{constructor(url){this.url=url;}play(){played.push(this.url);return Promise.resolve();}pause(){}}
 const context=vm.createContext({window:{},localStorage:{getItem:()=>null},Audio,console,clearTimeout,setTimeout});
 vm.runInContext(readFileSync(new URL('../static/js/sound.js',import.meta.url),'utf8'),context);
 const sound=context.window.soundEngine;sound.setSoundEnabled(false);
 sound.playPlayerSloganNow({slogan_audio_url:'/slogan.webm'});
 assert.deepEqual(played,['/slogan.webm']);assert.equal(sound.soundEnabled,false);
});
