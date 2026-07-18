// Login/signup page served by the Worker for the npx connector (device-code flow, ?code=<code>).
// Uses Supabase's auth REST directly (no CDN client) and the intendr "acid-lime" brand.
export function loginPage(supabaseUrl: string, anonKey: string, code: string): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="dark"/><title>Sign in to intendr</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700&family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet"/>
<style>
  :root{--bg:#08090b;--panel:#131619;--elev:#0e1013;--ink:#f3f6f4;--muted:#9aa3a0;--faint:#5b6360;
        --accent:#c6f24e;--accentInk:#0a0d05;--danger:#ff5d63;--hair:rgba(255,255,255,.08)}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:
    radial-gradient(900px 500px at 80% -10%, rgba(198,242,78,.10), transparent 60%), var(--bg);
    color:var(--ink);font-family:'Geist',system-ui,sans-serif;padding:20px}
  .card{width:380px;max-width:100%;padding:30px;border:1px solid var(--hair);border-radius:16px;
    background:linear-gradient(180deg,var(--panel),var(--elev));box-shadow:0 30px 80px -30px rgba(0,0,0,.7)}
  .brand{display:flex;align-items:center;gap:9px;margin-bottom:20px}
  .dot{width:22px;height:22px;border-radius:6px;background:var(--accent);box-shadow:0 0 18px rgba(198,242,78,.5)}
  .brand b{font-family:'Bricolage Grotesque',sans-serif;font-weight:700;font-size:18px;letter-spacing:-.02em}
  h1{font-family:'Bricolage Grotesque',sans-serif;font-weight:700;font-size:23px;line-height:1.15;margin:0 0 6px;letter-spacing:-.02em}
  h1 .g{color:var(--accent)}
  p.sub{margin:0 0 20px;color:var(--muted);font-size:13px}
  .tabs{display:flex;gap:6px;margin-bottom:16px;background:var(--elev);padding:4px;border-radius:10px;border:1px solid var(--hair)}
  .tabs button{flex:1;padding:8px;border:0;background:transparent;color:var(--muted);border-radius:7px;cursor:pointer;font:inherit;font-size:13px;font-weight:500}
  .tabs button.on{background:var(--accent);color:var(--accentInk);font-weight:600}
  label{display:block;font-size:12px;color:var(--muted);margin:12px 0 6px}
  input{width:100%;padding:11px 12px;border:1px solid var(--hair);background:#0b0d10;color:var(--ink);border-radius:9px;font:inherit;font-size:14px;outline:none}
  input:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(198,242,78,.15)}
  button.go{width:100%;margin-top:18px;padding:13px;border:0;border-radius:10px;background:var(--accent);color:var(--accentInk);font:inherit;font-size:14px;font-weight:600;cursor:pointer}
  button.go:disabled{opacity:.6;cursor:default}
  #msg{min-height:18px;margin-top:12px;font-size:12.5px;color:var(--danger)}
  #msg.ok{color:var(--accent)}
  .foot{margin-top:16px;font-family:'Geist Mono',monospace;font-size:11px;color:var(--faint)}
</style></head><body>
<div class="card">
  <div class="brand"><span class="dot"></span><b>intendr</b></div>
  <h1>Give your agent its own <span class="g">spend-capped wallet</span>.</h1>
  <p class="sub">Sign in to connect — your agent spends against your wallet, never your card.</p>
  <div class="tabs"><button id="tin" class="on" type="button">Sign in</button><button id="tup" type="button">Create account</button></div>
  <div id="nameWrap" style="display:none"><label>Display name</label><input id="name" placeholder="Ada Lovelace" autocomplete="name"/></div>
  <label>Email</label><input id="email" type="email" placeholder="you@example.com" autocomplete="email"/>
  <label>Password</label><input id="password" type="password" placeholder="••••••••" autocomplete="current-password"/>
  <button class="go" id="go">Sign in</button>
  <p id="msg"></p>
  <div class="foot">$45.00 cap · guardrails on · you never handle a key</div>
</div>
<script>
const SB=${JSON.stringify(supabaseUrl)}, ANON=${JSON.stringify(anonKey)}, CODE=${JSON.stringify(code)};
const $=function(i){return document.getElementById(i)};
let mode='in';
function setMode(m){mode=m;
  $('tin').classList.toggle('on',m==='in');$('tup').classList.toggle('on',m==='up');
  $('go').textContent=m==='in'?'Sign in':'Create wallet';
  $('nameWrap').style.display=m==='up'?'block':'none';$('msg').textContent='';}
$('tin').onclick=function(){setMode('in')};$('tup').onclick=function(){setMode('up')};
async function req(path,body){
  const r=await fetch(SB+'/auth/v1/'+path,{method:'POST',headers:{apikey:ANON,'content-type':'application/json'},body:JSON.stringify(body)});
  const d=await r.json().catch(function(){return {}});
  if(!r.ok) throw new Error(d.msg||d.error_description||d.error||('request failed ('+r.status+')'));
  return d;
}
async function finish(s){
  const code=CODE||new URLSearchParams(location.search).get('code');
  if(!code){$('msg').className='ok';$('msg').textContent='Connected ✓ — return to your terminal.';return;}
  const r=await fetch('/auth/complete',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({code:code,access_token:s.access_token,refresh_token:s.refresh_token||'',expires_in:s.expires_in||3600})});
  if(!r.ok) throw new Error('Could not hand the session to the connector ('+r.status+'). Re-run the connector.');
  $('msg').className='ok';$('msg').textContent='Connected ✓ — return to your terminal.';
}
$('go').onclick=async function(){
  const email=$('email').value.trim(), password=$('password').value, name=$('name').value.trim();
  $('msg').className='';$('msg').textContent='Working…';$('go').disabled=true;
  try{
    if(!email||!password) throw new Error('Enter an email and password (6+ chars).');
    let s;
    if(mode==='up'){
      s=await req('signup',{email:email,password:password,data:{display_name:name||email.split('@')[0]}});
      if(!s.access_token) s=await req('token?grant_type=password',{email:email,password:password});
    } else {
      s=await req('token?grant_type=password',{email:email,password:password});
    }
    if(!s.access_token) throw new Error('No session returned.');
    $('msg').className='ok';$('msg').textContent='Connecting…';
    await finish(s);
  }catch(e){$('msg').className='';$('msg').textContent=(e&&e.message)||String(e);$('go').disabled=false;}
};
</script></body></html>`;
}
