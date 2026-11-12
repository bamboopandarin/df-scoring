import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {TournamentManager} from '../static/js/tournament.js';
import {localD1} from '../tools/local-d1.mjs';
import {ensureSchema,digest,randomToken} from '../server/auth.js';
const {default:worker} = await import(process.env.DF_TEST_WORKER_URL || '../static/_worker.js');
const rules={games_per_set:6,sets_to_win:2,tiebreak_at:6};
const players=Array.from({length:4},(_,i)=>({id:'p'+i,name:'Player '+i}));
const draft=()=>TournamentManager.createKnockoutTournament('Access Cup','padel','singles',players,rules);
function client(env,cookie='') { return async(path,method='GET',body)=>{
 const r=await worker.fetch(new Request('https://scoring.test/api/'+path,{method,headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(body)}),env);
 if(r.headers.has('Set-Cookie'))cookie=r.headers.get('Set-Cookie').split(';')[0];
 return {code:r.status,...await r.json()};
}; }
async function member(env,name){await ensureSchema(env.DF_SCORING_DB); const token=randomToken(32);const user={id:randomUUID(),name,email:name+'@gmail.com',role:'member',provider:'google_oauth'};
 await env.DF_SCORING_DB.prepare('INSERT INTO df_sessions VALUES (?,?,?,?)').bind(await digest(token),user.id,Date.now()+86400000,JSON.stringify(user)).run();return client(env,'df_session_v2='+token);}
async function setup(t){const db=localD1();t.after(()=>db.close());const password=randomUUID();const env={DF_SCORING_DB:db,DF_ADMIN_PASSWORD:password};const admin=client(env);await admin('auth/login','POST',{role:'admin',password});return{db,env,admin,a:await member(env,'referee'),b:await member(env,'spectator'),anon:client(env)};}
const fixture=(t,m)=>({id:'m_'+randomUUID(),sport:'padel',mode:'singles',rules,team_a_name:'A',team_b_name:'B',team_a_players:[players[0]],team_b_players:[players[1]],tournament_id:t?.id,tournament_match_id:m?.id});

test('member creates protected tournament; only admin manages players; passwords gate all match mutations',async t=>{
 const {admin,a,b,anon}=await setup(t);const password=randomUUID();
 for(const method of ['POST','PUT','DELETE']) assert.equal((await b('players'+(method==='POST'?'':'/p0'),method,{name:'Hacked'})).code,403);
 assert.equal((await b('upload-photo','POST',{})).code,403);
 assert.equal((await a('tournaments','POST',draft())).code,400);
 const tournament=await a('tournaments','POST',{...draft(),password});assert.equal(tournament.code,200);
 assert.equal(tournament.password,undefined);assert.equal(tournament.password_hash,undefined);
 const match=tournament.rounds[0].matches[0];const launch=fixture(tournament,match);
 assert.equal((await a('courts/court_1/start','POST',launch)).code,403,'creator must also unlock');
 assert.equal((await b('tournaments/'+tournament.id,'DELETE')).code,403);
 assert.equal((await b('tournaments/'+tournament.id,'PUT',tournament)).code,403);
 assert.equal((await b('matches','POST',{tournament_id:tournament.id,tournament_match_id:match.id,win_type:'walkover',winner:'team_a'})).code,403);
 assert.equal((await a('tournaments/'+tournament.id+'/unlock','POST',{password:randomUUID()})).code,403);
 assert.equal((await a('tournaments/'+tournament.id+'/unlock','POST',{password})).code,200);
 assert((await a('bootstrap')).referee_tournaments.includes(tournament.id));
 assert.deepEqual((await b('bootstrap')).referee_tournaments,[]);
 const started=await a('courts/court_1/start','POST',launch);assert.equal(started.code,200);
 const active=started.court.active_match;const args={match_id:active.id,version:active.version,action:{type:'point',team:'team_a'},winner:'team_a'};
 for(const action of ['score','finish','cancel'])assert.equal((await b('courts/court_1/'+action,'POST',args)).code,403);
 const live=await anon('live');assert.equal(live.courts[0].active_match.tournament_id,tournament.id);
 assert(!JSON.stringify(await anon('bootstrap')).includes(password));assert(!JSON.stringify(live).includes('password_hash'));
 assert.equal((await a('courts/court_1/cancel','POST',args)).code,200);
 assert.equal((await anon('courts')).code,200);
 const fresh=await a('courts/court_1/start','POST',fixture(tournament,match));assert.equal(fresh.code,200);
 await admin('tournaments/'+tournament.id+'/password','POST',{password:randomUUID()});
 assert.equal((await a('courts/court_1/score','POST',{...args,match_id:fresh.court.active_match.id})).code,403,'changing password revokes old grants');
 assert.equal((await admin('tournaments/'+tournament.id,'DELETE')).code,200,'admin can delete an active tournament');
 assert.equal((await anon('live')).courts[0].active_match,null);
});

test('manual finish, resume and finish again preserve exact points and count stats once',async t=>{
 const {admin,a,b}=await setup(t);
 await admin('admin/restore','POST',{players});
 const tournament=await admin('tournaments','POST',{...draft(),password:randomUUID()});const opening=tournament.rounds[0].matches[0];
 let active=(await admin('courts/court_1/start','POST',fixture(tournament,opening))).court.active_match;
 active=(await admin('courts/court_1/score','POST',{match_id:active.id,version:active.version,action:{type:'point',team:'team_b'}})).court.active_match;
 const finish=await admin('courts/court_1/finish','POST',{match_id:active.id,version:active.version,winner:'team_a'});
 assert.equal(finish.match.resumable,true);assert.equal(finish.match.win_reason,'Diselesaikan manual');
 assert.equal((await b('matches/'+active.id+'/resume','POST',{court_id:'court_2'})).code,403);
 const resumed=await admin('matches/'+active.id+'/resume','POST',{court_id:'court_2'});assert.equal(resumed.code,200,JSON.stringify(resumed));
 assert.equal(resumed.court.active_match.display_point_b,'15');assert.equal(resumed.court.active_match.is_completed,false);
 assert.equal(resumed.court.active_match.sets_history.length,0);assert(resumed.court.active_match.undo_count>0);
 assert.equal((await admin('bootstrap')).matches.length,0);
 assert.equal((await admin('matches/'+active.id+'/resume','POST',{court_id:'court_3'})).code,409);
 const reopened=(await admin('bootstrap')).tournaments[0];assert.equal(TournamentManager.findMatch(reopened,opening.id).status,'pending');
 assert.equal(reopened.rounds[1].matches[0].team_a,null);
 const live=resumed.court.active_match;
 assert.equal((await admin('courts/court_2/finish','POST',{match_id:live.id,version:live.version,winner:'team_b'})).code,200);
 const after=await admin('bootstrap');assert.equal(after.matches.length,1);assert.equal(after.matches[0].winner,'team_b');
 assert.equal(after.players.find(p=>p.id===opening.team_a.id).matches_played,1);
 assert.equal(after.players.find(p=>p.id===opening.team_b.id).matches_won,1);
 assert.equal((await admin('tournaments/'+tournament.id,'DELETE')).code,200);
 const detached=(await admin('bootstrap')).matches[0];assert.equal(detached.tournament_id,null);assert.equal(detached.tournament_name,'Access Cup');
 assert.equal((await admin('matches/'+active.id+'/resume','POST',{court_id:'court_1'})).code,200);
});

test('friendly scoring belongs to its referee and resuming cannot overwrite an occupied court',async t=>{
 const {a,b,admin}=await setup(t);
 let active=(await a('courts/court_1/start','POST',fixture())).court.active_match;
 assert.equal((await b('courts/court_1/score','POST',{match_id:active.id,version:active.version,action:{type:'point',team:'team_a'}})).code,403);
 await a('courts/court_1/finish','POST',{match_id:active.id,version:active.version,winner:'team_a'});
 await b('courts/court_1/start','POST',fixture());
 assert.equal((await a('matches/'+active.id+'/resume','POST',{court_id:'court_1'})).code,409);
 assert.equal((await a('matches/'+active.id+'/resume','POST',{court_id:'court_2'})).code,200);
 assert.equal((await admin('bootstrap')).matches.length,0);
});

test('cannot reopen an earlier round once its dependent match has started',async t=>{
 const {admin}=await setup(t);const tournament=await admin('tournaments','POST',{...draft(),password:randomUUID()});
 let firstId;
 for(const opening of tournament.rounds[0].matches){const active=(await admin('courts/court_1/start','POST',fixture(tournament,opening))).court.active_match;firstId ||= active.id;await admin('courts/court_1/finish','POST',{match_id:active.id,version:active.version,winner:'team_a'});}
 const updated=(await admin('bootstrap')).tournaments[0];
 await admin('courts/court_2/start','POST',fixture(updated,updated.rounds[1].matches[0]));
 assert.equal((await admin('matches/'+firstId+'/resume','POST',{court_id:'court_3'})).code,409);
 assert.equal((await admin('bootstrap')).matches.length,2);
});


test('older manual results can resume without an original snapshot',async t=>{
 const {admin}=await setup(t);
 const old={...fixture(),status:'completed',is_completed:true,winner:'team_a',win_reason:'Diselesaikan manual',
  current_points:{team_a:2,team_b:1},current_set_games:{team_a:3,team_b:2},sets_history:[{team_a:3,team_b:2,partial:true}],version:1,duration_seconds:120};
 await admin('admin/restore','POST',{matches:[old]});
 assert.equal((await admin('bootstrap')).matches[0].resumable,true);
 const resumed=await admin('matches/'+old.id+'/resume','POST',{court_id:'court_1'});
 assert.equal(resumed.code,200,JSON.stringify(resumed));
 assert.equal(resumed.court.active_match.current_points.team_a,2);
 assert.equal(resumed.court.active_match.current_set_games.team_a,3);
 assert.equal(resumed.court.active_match.sets_history.length,0);
 assert.equal(resumed.court.active_match.is_completed,false);
});
