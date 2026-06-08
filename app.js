(function(){
  "use strict";
  /* ===== CONFIG: paste your Supabase project credentials ===== */
  const SUPABASE_URL = "https://wzjffxnueplmidcbgvzy.supabase.co";       // e.g. https://abcdxyz.supabase.co
  const SUPABASE_ANON_KEY = "sb_publishable_z0oayTse36euLp8zs_gcfA_84r1W_K7";  // your public anon key

  const REMOTE = !!(SUPABASE_URL && SUPABASE_ANON_KEY && window.supabase);
  const sb = REMOTE ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

  const $ = s => document.querySelector(s);
  const store = { projects:[], activeId:null, author:'', mode:'browse', sel:null, role:'admin', uid:null, email:'', clients:[] };
  const LS_KEY='siteFeedback.v2', LS_OLD='siteFeedback.v1';

  const frame=$('#frame'), overlay=$('#overlay'), wrap=$('#frameWrap'),
        svg=$('#drawSvg'), placeholder=$('#placeholder'), modePill=$('#modePill'), tabbar=$('#tabbar');
  const tools={browse:$('#tBrowse'),pin:$('#tPin'),rect:$('#tRect'),arrow:$('#tArrow'),pen:$('#tPen')};
  const list=$('#list'), emptyState=$('#emptyState');

  function uid(){ return Date.now()+''+Math.floor(Math.random()*9999); }
  function P(){ return store.projects.find(p=>p.id===store.activeId) || store.projects[0] || null; }
  function items(){ return P()?P().items:[]; }
  function isAdmin(){ return store.role==='admin'; }

  /* ---------- LOCAL persistence (used only when no Supabase config) ---------- */
  function saveLocal(){ if(REMOTE) return; try{ localStorage.setItem(LS_KEY, JSON.stringify({projects:store.projects,activeId:store.activeId,author:store.author})); }catch(e){} }
  function loadLocal(){
    try{
      const d=JSON.parse(localStorage.getItem(LS_KEY)||'null');
      if(d&&d.projects&&d.projects.length){ store.projects=d.projects; store.activeId=d.activeId; store.author=d.author||''; return; }
      const o=JSON.parse(localStorage.getItem(LS_OLD)||'null');
      if(o&&(o.items||o.url)){ const p={id:uid(),name:'Project 1',url:o.url||'',members:[],items:o.items||[]}; store.projects=[p]; store.activeId=p.id; store.author=o.author||''; return; }
    }catch(e){}
    const p={id:uid(),name:'Project 1',url:'',members:[],items:[]}; store.projects=[p]; store.activeId=p.id;
  }

  /* ---------- REMOTE (Supabase) ---------- */
  function rowToItem(f){ return {id:f.id,n:0,kind:f.kind,x:f.x,y:f.y,shape:f.shape,dev:f.dev||'desktop',text:f.text,cat:f.cat,prio:f.prio,status:f.status,author:f.author,ts:new Date(f.created_at).getTime()}; }
  function itemToRow(it){ return {id:it.id,project_id:store.activeId,kind:it.kind,x:(it.x==null?null:it.x),y:(it.y==null?null:it.y),shape:it.shape,dev:it.dev||'desktop',text:it.text,cat:it.cat,prio:it.prio,status:it.status,author:it.author}; }
  async function rInsertItem(it){ try{ const{error}=await sb.from('feedback').insert(itemToRow(it)); if(error) toast('Save error'); }catch(e){ toast('Save error'); } }
  async function rUpdateItem(it){ try{ await sb.from('feedback').update({status:it.status,text:it.text,cat:it.cat,prio:it.prio}).eq('id',it.id); }catch(e){} }
  async function rDeleteItem(id){ try{ await sb.from('feedback').delete().eq('id',id); }catch(e){} }
  async function rClearProject(pid,onlyDraw){ try{ let q=sb.from('feedback').delete().eq('project_id',pid); if(onlyDraw) q=q.eq('kind','draw'); await q; }catch(e){} }
  async function rInsertProject(p){ try{ const{error}=await sb.from('projects').insert({id:p.id,name:p.name,url:p.url||'',owner_id:store.uid}); if(error) toast('Project save error'); }catch(e){ toast('Project save error'); } }
  async function rUpdateProject(p){ try{ await sb.from('projects').update({name:p.name,url:p.url||''}).eq('id',p.id); }catch(e){} }
  async function rSetMembers(projectId, memberIds, prevIds){
    const cur=memberIds||[], prev=prevIds||[];
    const toDel=prev.filter(id=>cur.indexOf(id)<0), toAdd=cur.filter(id=>prev.indexOf(id)<0);
    try{
      if(toDel.length) await sb.from('project_members').delete().eq('project_id',projectId).in('user_id',toDel);
      if(toAdd.length) await sb.from('project_members').insert(toAdd.map(u=>({project_id:projectId,user_id:u})));
    }catch(e){ toast('Members error'); }
  }
  async function rDeleteProject(id){ try{ await sb.from('feedback').delete().eq('project_id',id); await sb.from('projects').delete().eq('id',id); }catch(e){} }

  async function refetchAll(initial){
    let projs=[], fbs=[], mems=[];
    try{
      const r1=await sb.from('projects').select('*').order('created_at',{ascending:true});
      const r2=await sb.from('feedback').select('*').order('created_at',{ascending:true});
      const r3=await sb.from('project_members').select('project_id,user_id');
      if(r1.error||r2.error){ toast('Sync error'); return; }
      projs=r1.data||[]; fbs=r2.data||[]; mems=r3.data||[];
    }catch(e){ toast('Sync error'); return; }
    const memMap={}; mems.forEach(m=>{ (memMap[m.project_id]=memMap[m.project_id]||[]).push(m.user_id); });
    const projects=projs.map(p=>({id:p.id,name:p.name,url:p.url||'',members:memMap[p.id]||[],items:[]}));
    const byId=Object.fromEntries(projects.map(p=>[p.id,p]));
    fbs.forEach(f=>{ const p=byId[f.project_id]; if(p) p.items.push(rowToItem(f)); });
    store.projects=projects;
    if(!store.activeId || !byId[store.activeId]) store.activeId=projects.length?projects[0].id:null;
    if(initial){ const cur=P(); if(cur){ $('#urlInput').value=cur.url||''; if(cur.url) loadUrl(cur.url,true); else resetPlaceholder(); } else resetPlaceholder(); autoDevice(); }
    renderAll();
  }
  let rtTimer; function queueRefetch(){ clearTimeout(rtTimer); rtTimer=setTimeout(()=>refetchAll(false),250); }
  function subscribe(){
    sb.channel('feedback-rt')
      .on('postgres_changes',{event:'*',schema:'public',table:'feedback'},queueRefetch)
      .on('postgres_changes',{event:'*',schema:'public',table:'projects'},queueRefetch)
      .on('postgres_changes',{event:'*',schema:'public',table:'project_members'},queueRefetch)
      .subscribe();
  }

  /* ---------- Auth ---------- */
  async function boot(){
    setChip();
    if(!REMOTE){ // private/local mode: no login, full access
      store.role='admin'; store.email=''; $('#userChip').style.display='none';
      document.body.classList.remove('loading'); document.body.classList.remove('is-client');
      $('#authGate').classList.add('hidden'); $('#app').classList.remove('hidden');
      loadLocal(); const cur=P(); if(cur){ $('#urlInput').value=cur.url||''; } renderAll(); setMode('browse');
      if(cur&&cur.url) loadUrl(cur.url,true); else resetPlaceholder();
      return;
    }
    let session=null;
    try{ const r=await sb.auth.getSession(); session=r.data.session; }catch(e){}
    if(session) await onSignedIn(session); else showLogin();
  }
  function showLogin(){ document.body.classList.remove('loading'); $('#app').classList.add('hidden'); $('#authGate').classList.remove('hidden'); setTimeout(()=>$('#loginEmail').focus(),60); }
  async function doLogin(){
    const email=$('#loginEmail').value.trim(), pass=$('#loginPass').value;
    if(!email||!pass){ $('#loginErr').textContent='Enter email and password.'; return; }
    $('#loginErr').textContent=''; const b=$('#loginBtn'); b.disabled=true; b.textContent='Signing in...';
    let res;
    try{ res=await sb.auth.signInWithPassword({email:email,password:pass}); }catch(e){ res={error:{message:'Network error'}}; }
    b.disabled=false; b.textContent='Sign in';
    if(res.error){ $('#loginErr').textContent=res.error.message||'Sign in failed.'; return; }
    await onSignedIn(res.data.session);
  }
  async function onSignedIn(session){
    store.uid=session.user.id; store.email=session.user.email||''; store.author=store.email;
    let role='client';
    try{ const r=await sb.from('profiles').select('role').eq('id',store.uid).maybeSingle(); if(r.data&&r.data.role) role=r.data.role; }catch(e){}
    store.role=role;
    document.body.classList.toggle('is-client', role!=='admin');
    const rb=$('#roleBadge'); rb.textContent=role; rb.className='role'+(role==='admin'?' admin':'');
    $('#userEmail').textContent=store.email; $('#signOutBtn').classList.remove('hidden');
    document.body.classList.remove('loading'); $('#authGate').classList.add('hidden'); $('#app').classList.remove('hidden');
    if(isAdmin()) await loadClients();
    setMode('browse');
    await refetchAll(true);
    subscribe();
  }
  async function loadClients(){
    try{ const r=await sb.from('profiles').select('id,email,role').order('email',{ascending:true}); store.clients=(r.data||[]).filter(p=>p.role!=='admin'); }catch(e){ store.clients=[]; }
  }
  $('#loginBtn').onclick=doLogin;
  $('#loginPass').addEventListener('keydown',e=>{ if(e.key==='Enter') doLogin(); });
  $('#loginEmail').addEventListener('keydown',e=>{ if(e.key==='Enter') $('#loginPass').focus(); });
  $('#signOutBtn').onclick=async()=>{ try{ await sb.auth.signOut(); }catch(e){} location.reload(); };

  /* ---------- Tabs ---------- */
  function membersLabel(p){ const ids=p.members||[]; if(!ids.length) return 'unassigned'; const names=ids.map(id=>{ const c=store.clients.find(x=>x.id===id); return c?c.email:'?'; }); return names.length<=2?names.join(', '):(names.length+' clients'); }
  function membersTitle(p){ const ids=p.members||[]; if(!ids.length) return 'No collaborators assigned'; return ids.map(id=>{ const c=store.clients.find(x=>x.id===id); return c?c.email:'?'; }).join(', '); }
  function renderTabs(){
    tabbar.innerHTML='';
    store.projects.forEach(p=>{
      const t=document.createElement('div'); t.className='tab'+(p.id===store.activeId?' active':'');
      let html='<span class="tdot"></span><span class="tname"></span>';
      if(isAdmin()) html+='<span class="tclient"></span>';
      html+='<span class="tcount">'+p.items.length+'</span>';
      if(isAdmin()) html+='<button class="tedit" title="Edit / assign client">&#9998;</button><button class="tclose" title="Delete project">&#10005;</button>';
      t.innerHTML=html;
      t.querySelector('.tname').textContent=p.name;
      if(isAdmin()){ const cl=t.querySelector('.tclient'); cl.textContent=membersLabel(p); cl.title=membersTitle(p); }
      t.onclick=e=>{ if(e.target.closest('.tclose')||e.target.closest('.tedit')) return; switchProject(p.id); };
      if(isAdmin()){
        t.title='Double-click to edit / assign';
        t.ondblclick=e=>{ if(e.target.closest('.tclose')||e.target.closest('.tedit')) return; openProjModal('edit',p.id); };
        t.querySelector('.tedit').onclick=e=>{ e.stopPropagation(); openProjModal('edit',p.id); };
        t.querySelector('.tclose').onclick=e=>{ e.stopPropagation(); closeProject(p.id); };
      }
      tabbar.appendChild(t);
    });
    if(isAdmin()){ const add=document.createElement('button'); add.className='tab-add'; add.textContent='+ New project'; add.onclick=()=>openProjModal('new'); tabbar.appendChild(add); }
  }
  function switchProject(id){
    if(id===store.activeId) return;
    store.activeId=id; store.sel=null; setMode('browse'); saveLocal();
    const p=P(); if(p){ $('#urlInput').value=p.url||''; if(p.url) loadUrl(p.url,true); else { frame.removeAttribute('src'); resetPlaceholder(); } }
    autoDevice(); renderAll();
  }
  function closeProject(id){
    if(!isAdmin()) return;
    const p=store.projects.find(x=>x.id===id); if(!p) return;
    if(p.items.length && !confirm('Delete "'+p.name+'"? Its '+p.items.length+' feedback item(s) will be deleted for everyone.')) return;
    const idx=store.projects.findIndex(x=>x.id===id);
    store.projects=store.projects.filter(x=>x.id!==id);
    if(REMOTE) rDeleteProject(id);
    if(store.activeId===id) store.activeId=store.projects.length?store.projects[Math.max(0,idx-1)].id:null;
    store.sel=null; saveLocal();
    const cur=P(); if(cur){ $('#urlInput').value=cur.url||''; if(cur.url) loadUrl(cur.url,true); else { frame.removeAttribute('src'); resetPlaceholder(); } }
    else { frame.removeAttribute('src'); resetPlaceholder(); }
    setMode('browse'); renderAll();
  }

  /* ---------- Project modal (admin create / edit / assign) ---------- */
  let projEditId=null;
  function openProjModal(mode,id){
    if(!isAdmin()) return;
    projEditId = mode==='edit'?id:null;
    $('#projTitle').textContent = mode==='edit'?'Edit project':'New project';
    const p = mode==='edit'?store.projects.find(x=>x.id===id):null;
    $('#pmName').value = p?p.name:''; $('#pmUrl').value = p?(p.url||''):'';
    const box=$('#pmClients'); box.innerHTML='';
    $('#pmNoClients').style.display = store.clients.length?'none':'block';
    const cur = (p&&p.members)?p.members:[];
    store.clients.forEach(c=>{
      const lab=document.createElement('label');
      const cb=document.createElement('input'); cb.type='checkbox'; cb.value=c.id; if(cur.indexOf(c.id)>=0) cb.checked=true;
      const sp=document.createElement('span'); sp.textContent=c.email;
      lab.appendChild(cb); lab.appendChild(sp); box.appendChild(lab);
    });
    $('#projModalBg').classList.add('show'); setTimeout(()=>$('#pmName').focus(),30);
  }
  $('#pmCancel').onclick=()=>$('#projModalBg').classList.remove('show');
  $('#projModalBg').addEventListener('mousedown',e=>{ if(e.target===$('#projModalBg')) $('#projModalBg').classList.remove('show'); });
  $('#pmSave').onclick=async()=>{
    const name=$('#pmName').value.trim(); if(!name){ $('#pmName').focus(); return; }
    let url=$('#pmUrl').value.trim(); if(url && !/^https?:\/\//i.test(url)) url='https://'+url;
    const memberIds=Array.prototype.slice.call($('#pmClients').querySelectorAll('input:checked')).map(cb=>cb.value);
    if(projEditId){
      const p=store.projects.find(x=>x.id===projEditId);
      if(p){ const prev=p.members||[]; p.name=name; p.url=url; p.members=memberIds; if(REMOTE){ await rUpdateProject(p); await rSetMembers(p.id,memberIds,prev); } }
    } else {
      const p={id:uid(),name:name,url:url,members:memberIds,items:[]};
      store.projects.push(p); store.activeId=p.id; if(REMOTE){ await rInsertProject(p); await rSetMembers(p.id,memberIds,[]); }
    }
    saveLocal(); $('#projModalBg').classList.remove('show');
    const cur=P(); if(cur){ $('#urlInput').value=cur.url||''; if(cur.url) loadUrl(cur.url,true); else resetPlaceholder(); }
    setMode('browse'); renderAll();
  };
  function resetPlaceholder(){
    placeholder.style.display='flex';
    if(!P()){
      placeholder.innerHTML = isAdmin()
        ? '<h2>No projects yet</h2><div class="hint" style="max-width:420px">Click <b>+ New project</b> to add a site URL and assign it to a client.</div>'
        : '<h2>No projects assigned</h2><div class="hint" style="max-width:420px">Your administrator has not shared a project with you yet.</div>';
      return;
    }
    placeholder.innerHTML='<h2>Load the site to begin</h2>'+
      (isAdmin()?'<div>Enter a URL above and press <kbd>Load</kbd>.</div>':'')+
      '<div class="hint" style="max-width:420px">Switch to a tool (Pin, Box, Arrow, Draw) to leave feedback on top of the page.<br>Use <b>Browse</b> to click around the real site.</div>';
  }

  /* ---------- URL loading ---------- */
  $('#urlForm').addEventListener('submit', e=>{ e.preventDefault(); if(isAdmin()) loadUrl($('#urlInput').value.trim()); });
  function loadUrl(u,silent){
    if(!u) return;
    if(!/^https?:\/\//i.test(u)) u='https://'+u;
    const cur=P(); const changed = cur && cur.url!==u;
    if(cur) cur.url=u; $('#urlInput').value=u;
    if(changed && isAdmin()){ saveLocal(); if(REMOTE) rUpdateProject(cur); }
    frame.src=u; placeholder.style.display='none';
    let settled=false; frame.onload=()=>{ settled=true; };
    setTimeout(()=>{
      try{ void frame.contentWindow.location.href; }catch(_){ settled=true; }
      if(!settled){
        placeholder.style.display='flex';
        placeholder.innerHTML='<h2>This site blocked embedding</h2>'+
          '<div class="hint" style="max-width:440px">The site sends <code>X-Frame-Options</code> or a frame-blocking <code>Content-Security-Policy</code>, so it cannot load inside another page. Allow framing for this tool, or test a staging build that permits it.</div>';
      }
    },2500);
    if(!silent) toast('Loading '+u);
  }

  /* ---------- Mode / tools ---------- */
  function setMode(m){
    store.mode=m;
    Object.values(tools).forEach(b=>b.classList.remove('active'));
    (tools[m]||tools.browse).classList.add('active');
    const labels={browse:'Browse',pin:'Pin a comment',rect:'Draw a box',arrow:'Draw an arrow',pen:'Freehand draw'};
    modePill.textContent='Mode: '+labels[m];
    if(m==='browse'){ overlay.classList.remove('capture'); } else { overlay.classList.add('capture'); }
  }
  tools.browse.onclick=()=>setMode('browse');
  tools.pin.onclick=()=>setMode('pin');
  tools.rect.onclick=()=>setMode('rect');
  tools.arrow.onclick=()=>setMode('arrow');
  tools.pen.onclick=()=>setMode('pen');
  document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&!pending) setMode('browse'); });
  // Percentage coordinates within the preview area (the iframe fills the stage at its natural width).
  function pct(e){ const r=wrap.getBoundingClientRect(); return {x:((e.clientX-r.left)/r.width)*100, y:((e.clientY-r.top)/r.height)*100}; }
  function autoDevice(){}
  function ensurePageHeight(){}

  /* ---------- Mobile feedback drawer ---------- */
  $('#fabFeedback').onclick=()=>document.body.classList.add('panel-open');
  $('#panelHandle').onclick=()=>document.body.classList.remove('panel-open');

  /* ---------- Drawing ---------- */
  let drawing=null;
  overlay.addEventListener('pointerdown', e=>{
    if(store.mode==='browse'||!P()) return;
    e.preventDefault();
    const p=pct(e);
    if(store.mode==='pin'){ openModal({type:'pin',x:p.x,y:p.y}); return; }
    try{ overlay.setPointerCapture(e.pointerId); }catch(_){}
    drawing={tool:store.mode,sx:p.x,sy:p.y,pts:[[p.x,p.y]]};
  });
  overlay.addEventListener('pointermove', e=>{
    if(!drawing) return; e.preventDefault(); const p=pct(e);
    if(drawing.tool==='pen'){ drawing.pts.push([p.x,p.y]); renderTempPen(drawing); }
    else { drawing.ex=p.x; drawing.ey=p.y; renderTempShape(drawing); }
  });
  window.addEventListener('pointerup', ()=>{
    if(!drawing) return;
    const tmp=svg.querySelector('#temp'); if(tmp) tmp.remove();
    const d=drawing; drawing=null;
    const big = d.tool==='pen' ? d.pts.length>3 : (Math.abs((d.ex||d.sx)-d.sx)+Math.abs((d.ey||d.sy)-d.sy))>1.5;
    if(!big) return;
    const shape = d.tool==='pen' ? {kind:'pen',pts:d.pts} : {kind:d.tool,x1:d.sx,y1:d.sy,x2:d.ex,y2:d.ey};
    openModal({type:'draw',shape});
  });
  function renderTempShape(d){
    let t=svg.querySelector('#temp'); if(t) t.remove();
    const ns='http://www.w3.org/2000/svg', w=wrap.clientWidth,h=wrap.clientHeight;
    const x1=d.sx/100*w,y1=d.sy/100*h,x2=(d.ex==null?d.sx:d.ex)/100*w,y2=(d.ey==null?d.sy:d.ey)/100*h; let el;
    if(d.tool==='rect'){ el=document.createElementNS(ns,'rect'); el.setAttribute('x',Math.min(x1,x2));el.setAttribute('y',Math.min(y1,y2));el.setAttribute('width',Math.abs(x2-x1));el.setAttribute('height',Math.abs(y2-y1)); }
    else { el=document.createElementNS(ns,'line'); el.setAttribute('x1',x1);el.setAttribute('y1',y1);el.setAttribute('x2',x2);el.setAttribute('y2',y2);el.setAttribute('marker-end','url(#arrow)'); }
    el.setAttribute('id','temp'); el.setAttribute('fill','none'); el.setAttribute('stroke','#5b8cff'); el.setAttribute('stroke-width','3'); el.setAttribute('stroke-dasharray','6 4');
    svg.appendChild(el);
  }
  function renderTempPen(d){
    let t=svg.querySelector('#temp'); if(t) t.remove();
    const ns='http://www.w3.org/2000/svg', w=wrap.clientWidth,h=wrap.clientHeight;
    const el=document.createElementNS(ns,'polyline');
    el.setAttribute('points',d.pts.map(p=>(p[0]/100*w)+','+(p[1]/100*h)).join(' '));
    el.setAttribute('id','temp');el.setAttribute('fill','none');el.setAttribute('stroke','#5b8cff');el.setAttribute('stroke-width','3');el.setAttribute('stroke-linejoin','round');el.setAttribute('stroke-linecap','round');
    svg.appendChild(el);
  }

  /* ---------- Feedback modal ---------- */
  let pending=null;
  function openModal(ctx){
    if(!P()) return;
    pending=ctx;
    $('#modalTitle').textContent = ctx.type==='pin'?'Add pinned comment':'Add comment to drawing';
    $('#mText').value=''; $('#mCat').value='other'; $('#mPrio').value='medium'; $('#mAuthor').value=store.author||'';
    $('#modalBg').classList.add('show'); setTimeout(()=>$('#mText').focus(),30);
  }
  function closeModal(){ $('#modalBg').classList.remove('show'); pending=null; }
  $('#mCancel').onclick=closeModal;
  $('#modalBg').addEventListener('mousedown',e=>{ if(e.target===$('#modalBg')) closeModal(); });
  $('#mSave').onclick=()=>{
    if(!pending||!P()) return;
    const text=$('#mText').value.trim(); if(!text){ $('#mText').focus(); return; }
    store.author=$('#mAuthor').value.trim();
    const item={ id:uid(), n:0, kind:pending.type, x:pending.x, y:pending.y, shape:pending.shape||null,
      text:text, cat:$('#mCat').value, prio:$('#mPrio').value, status:'open', author:store.author||'Anon', ts:Date.now() };
    P().items.push(item); saveLocal(); if(REMOTE) rInsertItem(item);
    renderAll(); closeModal(); setMode('browse'); toast('Feedback added');
  };
  document.addEventListener('keydown',e=>{ if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)&&pending) $('#mSave').click(); });

  /* ---------- Render ---------- */
  const catLabel={bug:'Bug',copy:'Copy',design:'Design',ux:'UX',other:'Other'};
  const devName=d=>({desktop:'Desktop',tablet:'Tablet',mobile:'Mobile'})[d||'desktop'];
  function filtered(){
    const fs=$('#fStatus').value,fc=$('#fCat').value,fp=$('#fPrio').value;
    return items().filter(i=>(!fs||i.status===fs)&&(!fc||i.cat===fc)&&(!fp||i.prio===fp));
  }
  function renumber(){ let n=1; items().forEach(i=>{ if(i.kind==='pin') i.n=n++; }); }
  function renderAll(){ renderTabs(); render(); }
  function render(){
    renumber();
    $('#sideTitle').textContent = P()?P().name:'No project';
    $('#cOpen').textContent=items().filter(i=>i.status==='open').length;
    $('#cProg').textContent=items().filter(i=>i.status==='progress').length;
    $('#cDone').textContent=items().filter(i=>i.status==='resolved').length;
    $('#fabCount').textContent=items().length;
    ensurePageHeight();
    renderOverlay();
    list.innerHTML='';
    if(!P()){ resetPlaceholder(); const d=document.createElement('div');d.className='empty';d.textContent=isAdmin()?'Create a project to start collecting feedback.':'No project assigned yet.';list.appendChild(d);return; }
    const fitems=filtered();
    if(!items().length){ list.appendChild(emptyState); emptyState.style.display='block'; return; }
    if(!fitems.length){ const d=document.createElement('div');d.className='empty';d.textContent='No items match the current filters.';list.appendChild(d);return; }
    fitems.forEach(i=>list.appendChild(card(i)));
  }
  function card(i){
    const el=document.createElement('div'); el.className='card'; el.dataset.id=i.id;
    el.innerHTML='<div class="chead">'+
        '<span class="num '+(i.kind==='draw'?'draw':'')+'">'+(i.kind==='draw'?'&#9998;':i.n)+'</span>'+
        '<span class="tag cat-'+i.cat+'">'+catLabel[i.cat]+'</span>'+
        '<span class="prio '+i.prio+'"><span class="d"></span>'+i.prio+'</span></div>'+
      '<div class="ctext"></div>'+
      '<div class="cmeta"><span class="who"></span><span class="ago"></span>'+
        '<span class="status-sel"><select>'+
          '<option value="open" '+(i.status==='open'?'selected':'')+'>&#9679; Open</option>'+
          '<option value="progress" '+(i.status==='progress'?'selected':'')+'>&#9679; In progress</option>'+
          '<option value="resolved" '+(i.status==='resolved'?'selected':'')+'>&#9679; Resolved</option>'+
        '</select></span>'+
        '<button class="del" title="Delete">&#10005;</button></div>';
    el.querySelector('.ctext').textContent=i.text;
    el.querySelector('.who').textContent=i.author;
    el.querySelector('.ago').textContent='· '+timeAgo(i.ts);
    const sel=el.querySelector('select');
    sel.onclick=e=>e.stopPropagation();
    sel.onchange=e=>{ i.status=e.target.value; saveLocal(); if(REMOTE) rUpdateItem(i); render(); };
    el.querySelector('.del').onclick=e=>{ e.stopPropagation(); P().items=items().filter(x=>x.id!==i.id); saveLocal(); if(REMOTE) rDeleteItem(i.id); renderAll(); };
    el.onclick=()=>selectItem(i.id);
    if(store.sel===i.id) el.classList.add('sel');
    return el;
  }
  function renderOverlay(){
    overlay.querySelectorAll('.pin').forEach(p=>p.remove());
    svg.innerHTML='<defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L9,3 L0,6 Z" fill="#5b8cff"/></marker></defs>';
    const w=wrap.clientWidth,h=wrap.clientHeight,ns='http://www.w3.org/2000/svg';
    items().forEach(i=>{
      if(i.kind==='pin'){
        const p=document.createElement('div');
        p.className='pin cat-'+i.cat+' st-'+i.status+(store.sel===i.id?' sel':'');
        p.style.left=i.x+'%'; p.style.top=i.y+'%';
        p.innerHTML='<span>'+i.n+'</span>'; p.title=i.text;
        p.onclick=ev=>{ ev.stopPropagation(); selectItem(i.id); };
        overlay.appendChild(p);
      } else if(i.shape){
        const s=i.shape; let el;
        if(s.kind==='rect'){ el=document.createElementNS(ns,'rect');
          el.setAttribute('x',Math.min(s.x1,s.x2)/100*w);el.setAttribute('y',Math.min(s.y1,s.y2)/100*h);
          el.setAttribute('width',Math.abs(s.x2-s.x1)/100*w);el.setAttribute('height',Math.abs(s.y2-s.y1)/100*h);
        } else if(s.kind==='arrow'){ el=document.createElementNS(ns,'line');
          el.setAttribute('x1',s.x1/100*w);el.setAttribute('y1',s.y1/100*h);el.setAttribute('x2',s.x2/100*w);el.setAttribute('y2',s.y2/100*h);
          el.setAttribute('marker-end','url(#arrow)');
        } else { el=document.createElementNS(ns,'polyline');
          el.setAttribute('points',s.pts.map(p=>(p[0]/100*w)+','+(p[1]/100*h)).join(' '));
        }
        el.setAttribute('fill','none');
        el.setAttribute('stroke', store.sel===i.id?'#fff':'#5b8cff');
        el.setAttribute('stroke-width', store.sel===i.id?'4':'3');
        el.setAttribute('stroke-linejoin','round');el.setAttribute('stroke-linecap','round');
        el.style.pointerEvents='stroke'; el.style.cursor='pointer';
        el.addEventListener('click',ev=>{ ev.stopPropagation(); selectItem(i.id); });
        svg.appendChild(el);
      }
    });
  }
  function shapeCenter(s){
    if(!s) return {x:0,y:0};
    if(s.kind==='pen'){ const xs=s.pts.map(p=>p[0]),ys=s.pts.map(p=>p[1]); return {x:(Math.min.apply(null,xs)+Math.max.apply(null,xs))/2,y:(Math.min.apply(null,ys)+Math.max.apply(null,ys))/2}; }
    return {x:(s.x1+s.x2)/2,y:(s.y1+s.y2)/2};
  }
  function selectItem(id){ store.sel=store.sel===id?null:id; render(); const c=list.querySelector('.card[data-id="'+id+'"]'); if(c) c.scrollIntoView({block:'nearest',behavior:'smooth'}); }

  $('#tClearDraw').onclick=()=>{
    if(!P()) return;
    const draws=items().filter(i=>i.kind==='draw');
    if(!draws.length){ toast('No drawings to clear'); return; }
    if(confirm('Remove all box/arrow/pen drawings in this project? (Pins are kept.)')){
      P().items=items().filter(i=>i.kind!=='draw'); saveLocal(); if(REMOTE) rClearProject(store.activeId,true); renderAll();
    }
  };
  ['#fStatus','#fCat','#fPrio'].forEach(s=>$(s).addEventListener('change',render));

  /* ---------- Export ---------- */
  $('#exJson').onclick=()=>{ const p=P(); if(!p) return; download(slug(p.name)+'-feedback.json','application/json',JSON.stringify({project:p.name,url:p.url,exported:new Date().toISOString(),count:p.items.length,items:p.items},null,2)); };
  $('#exCsv').onclick=()=>{
    const p=P(); if(!p) return; const head=['#','type','category','priority','status','author','comment','x','y','device','created'];
    const rows=p.items.map(i=>[i.n,i.kind,i.cat,i.prio,i.status,i.author,i.text,i.x?Math.round(i.x):'',i.y?Math.round(i.y):'',i.dev||'desktop',new Date(i.ts).toISOString()]);
    const csv=[head].concat(rows).map(r=>r.map(c=>'"'+String(c).replace(/"/g,'""')+'"').join(',')).join('\n');
    download(slug(p.name)+'-feedback.csv','text/csv',csv);
  };
  function slug(s){ return (s||'project').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'project'; }
  function download(name,type,content){ const b=new Blob([content],{type:type}); const a=document.createElement('a'); a.href=URL.createObjectURL(b); a.download=name; a.click(); URL.revokeObjectURL(a.href); toast('Exported '+name); }
  $('#clearAll').onclick=()=>{ if(!isAdmin()||!P()) return; if(items().length&&confirm('Delete ALL feedback in "'+P().name+'"? This cannot be undone.')){ P().items=[]; store.sel=null; saveLocal(); if(REMOTE) rClearProject(store.activeId,false); renderAll(); } };
  function timeAgo(ts){ const s=(Date.now()-ts)/1000; if(s<60)return'just now'; if(s<3600)return Math.floor(s/60)+'m ago'; if(s<86400)return Math.floor(s/3600)+'h ago'; return Math.floor(s/86400)+'d ago'; }
  let toastT; function toast(m){ const t=$('#toast'); t.textContent=m; t.classList.add('show'); clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove('show'),1800); }
  window.addEventListener('resize',renderOverlay);
  function setChip(){ const c=$('#syncChip'); if(REMOTE){ c.classList.add('on'); $('#syncTxt').textContent='Shared (live)'; c.title='Connected to Supabase - shared in real time'; } else { $('#syncTxt').textContent='Local'; c.title='Private mode - feedback stays in this browser.'; } }

  boot();
})();
