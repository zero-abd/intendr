// Minimal login/signup page served by the Worker. The npx connector opens this in a browser,
// the user authenticates against Supabase (client-side, anon key), and the page hands the
// session tokens back to the connector's loopback server (?port=).
export function loginPage(supabaseUrl: string, anonKey: string): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Sign in to intendr</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#08090b;color:#e7e7ea;
       font-family:'Geist',system-ui,sans-serif}
  .card{width:340px;padding:28px;border:1px solid #1e2024;border-radius:14px;background:#0f1115}
  h1{margin:0 0 2px;font-size:22px}
  p.sub{margin:0 0 18px;color:#8a8f98;font-size:13px}
  .tabs{display:flex;gap:6px;margin-bottom:14px}
  .tabs button{flex:1;padding:8px;border:1px solid #23262b;background:#14161a;color:#9aa0a8;border-radius:8px;cursor:pointer;font-size:13px}
  .tabs button.active{background:#4f46e5;border-color:#4f46e5;color:#fff}
  input{width:100%;padding:11px 12px;margin-bottom:10px;border:1px solid #23262b;background:#0b0d10;color:#e7e7ea;border-radius:8px;font-size:14px}
  button.go{width:100%;padding:12px;border:0;border-radius:8px;background:#4f46e5;color:#fff;font-size:14px;font-weight:600;cursor:pointer}
  #msg{min-height:18px;margin:12px 0 0;font-size:12.5px;color:#8a8f98}
</style></head><body>
<div class="card">
  <h1>intendr</h1><p class="sub">Sign in to connect your wallet to your agent.</p>
  <div class="tabs"><button id="tin" class="active">Sign in</button><button id="tup">Sign up</button></div>
  <input id="email" type="email" placeholder="you@example.com" autocomplete="email"/>
  <input id="password" type="password" placeholder="password" autocomplete="current-password"/>
  <button class="go" id="go">Sign in</button>
  <p id="msg"></p>
</div>
<script type="module">
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const sb = createClient(${JSON.stringify(supabaseUrl)}, ${JSON.stringify(anonKey)});
const $ = (id) => document.getElementById(id);
let mode = 'in';
$('tin').onclick = () => { mode='in'; $('tin').classList.add('active'); $('tup').classList.remove('active'); $('go').textContent='Sign in'; };
$('tup').onclick = () => { mode='up'; $('tup').classList.add('active'); $('tin').classList.remove('active'); $('go').textContent='Sign up'; };
function finish(s){
  const port = new URLSearchParams(location.search).get('port');
  if(!port){ $('msg').textContent='Missing callback port — restart the connector.'; return; }
  location.href = 'http://127.0.0.1:'+port+'/callback?access_token='+encodeURIComponent(s.access_token)
    +'&refresh_token='+encodeURIComponent(s.refresh_token)+'&expires_in='+(s.expires_in||3600);
}
$('go').onclick = async () => {
  $('msg').textContent = 'Working…';
  const email = $('email').value.trim(), password = $('password').value;
  if(!email || !password){ $('msg').textContent='Enter an email and password.'; return; }
  try{
    const { data, error } = mode==='in'
      ? await sb.auth.signInWithPassword({ email, password })
      : await sb.auth.signUp({ email, password });
    if(error){ $('msg').textContent = error.message; return; }
    if(data.session){ finish(data.session); }
    else { $('msg').textContent = 'Account created — now hit Sign in.'; }
  }catch(e){ $('msg').textContent = String(e && e.message || e); }
};
</script></body></html>`;
}
