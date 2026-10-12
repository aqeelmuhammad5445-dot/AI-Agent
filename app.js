// Interactive front-end demo. Replace demoAgent() with POST /api/v1/runs in a connected deployment.
const $ = (id) => document.getElementById(id);
if (document.getElementById('instructions')) document.getElementById('instructions').value = AgentCore.SYSTEM_PROMPT;
const storage = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem(`orbit.${key}`)) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(`orbit.${key}`, JSON.stringify(value)); } catch { /* Storage may be disabled. */ } }
};

const runs = [
  {id:'AG-0932',request:'Summarize the onboarding guide',status:'Succeeded',duration:'2.1s',when:'2 min ago'},
  {id:'AG-0931',request:'Check account sync status',status:'Succeeded',duration:'3.8s',when:'5 min ago'},
  {id:'AG-0930',request:'Create a support ticket',status:'Awaiting approval',duration:'—',when:'8 min ago'},
  {id:'AG-0929',request:'Find the API setup steps',status:'Succeeded',duration:'1.9s',when:'12 min ago'},
  {id:'AG-0928',request:'Explain the access policy',status:'Running',duration:'—',when:'31 min ago'},
  {id:'AG-0927',request:'Look up export limits',status:'Failed',duration:'4.5s',when:'39 min ago'},
  {id:'AG-0926',request:'Summarize recent changes',status:'Succeeded',duration:'2.4s',when:'52 min ago'},
  {id:'AG-0925',request:'Find workspace owner',status:'Succeeded',duration:'3.1s',when:'1 hr ago'},
  {id:'AG-0924',request:'Check project status',status:'Succeeded',duration:'2.0s',when:'1 hr ago'}
];
const toolDefs = [
  {icon:'⌕',name:'knowledge_lookup',description:'Demo help-guidance fixture. No live knowledge base is connected.',timeout:'Sample result',scope:'Read only · demo',enabled:true},
  {icon:'◈',name:'account_status',description:'Demo sync-status fixture. No account service is connected.',timeout:'Sample result',scope:'Read only · demo',enabled:true},
  {icon:'◇',name:'workspace_setup',description:'Configuration verification is unavailable until a trusted backend and authorization provider are connected.',timeout:'Not connected',scope:'Unavailable · demo only',enabled:true},
  {icon:'⌑',name:'permission_check',description:'Permission verification requires an authorized permission source. Support guidance does not check access.',timeout:'Not connected',scope:'Unavailable · no source',enabled:true},
  {icon:'↻',name:'sync_diagnostics',description:'Live sync diagnostics are unavailable; the current account status handler returns demo data only.',timeout:'Not connected',scope:'Unavailable · no source',enabled:true},
  {icon:'＋',name:'create_ticket',description:'Approval-flow preview only. No ticket service is connected, so no ticket can be created.',timeout:'Not connected',scope:'Unavailable · preview',enabled:true,consequential:true}
];
// This is the actual adapter registry used by the dispatcher. The only
// workspace entry is a demo adapter that explicitly returns unavailable.
const workspaceVerificationAdapter = AgentCore.createDemoWorkspaceVerificationAdapter();
const demoAdapters = {
  account_status: async (_args, context) => {
    if (/\b(simulate error|simulate failure|force error|tool failure)\b/i.test(context.requestText||'')) throw new Error('simulated adapter failure');
    return AgentCore.makeToolResult({status:'success',data_source:'demo',result:{sync_status:'healthy'},message:'Illustrative sync status fixture.',limitations:['Demo data only; not a live account check.','Sync status does not establish overall account health or permissions.']});
  },
  knowledge_lookup: async (_args, context) => {
    if (/\b(simulate error|simulate failure|force error|tool failure)\b/i.test(context.requestText||'')) throw new Error('simulated adapter failure');
    const syncGuidance=context.task?.kind==='sync_troubleshooting_guidance'
      ? 'For a sync issue, check the platform’s official service-status page, confirm the intended workspace in the official application, note the exact error text or code, and review access in the official permissions interface. Retry only after checking service status.'
      : 'Review the configured workspace help content and confirm access using the approved account owner workflow.';
    return AgentCore.makeToolResult({status:'success',data_source:'demo',result:{guidance:syncGuidance},message:'Illustrative help-content fixture.',limitations:['Demo data only; no live knowledge base is connected.','Guidance does not verify actual workspace configuration, account state, or permissions.']});
  },
  workspace_setup: workspaceVerificationAdapter
};
let toolRegistry;
function refreshToolRegistry() {
  toolRegistry=AgentCore.createToolRegistry(demoAdapters,Object.fromEntries(toolDefs.map(tool=>[tool.name,tool.enabled])));
}
refreshToolRegistry();
let requestCount = 128;
let pendingText = '';
let activeRun = '';
let activeSurface = 'playground';
let activePlan = null;
let activeExecutionTrace = null;
let toastTimer;
let chatReplyPending = false;
let chatReplyStartedAt = 0;
const savedChats = storage.get('chatConversations', null);
let chatConversations = Array.isArray(savedChats) && savedChats.length
  ? savedChats
  : [{id:`chat-${Date.now()}`,title:((storage.get('chatMessages',[]).find(message=>message.role==='user')?.text)||'New chat').trim().replace(/\s+/g,' ').slice(0,42),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),messages:storage.get('chatMessages',[])}];
let activeConversationId = storage.get('activeChatConversationId', chatConversations[0].id);
if (!chatConversations.some(chat => chat.id === activeConversationId)) activeConversationId = chatConversations[0].id;
storage.set('chatConversations',chatConversations);
storage.set('activeChatConversationId',activeConversationId);

function barChart(target, labels, values) {
  const el = $(target);
  if (!el) return;
  el.innerHTML = labels.map((label, i) => `<div class="barwrap" style="--h:${Math.max(10, values[i])}%"><span class="barvalue">${values[i]}</span><div class="bar"></div><span class="barlabel">${label}</span></div>`).join('');
}
barChart('overview-bars',['08','09','10','11','12','13','14','15','16','17','18','19'],[32,48,42,70,52,88,67,58,94,72,61,79]);
barChart('chat-bars',['ASK','PLAN','CHECK','TOOL','REPLY'],[48,71,59,83,92]);
barChart('pipeline-bars',['INPUT','PLAN','POLICY','TOOL','RESULT'],[43,68,57,77,92]);
barChart('runs-bars',['24','25','26','27','28','29','30','31','32','33','34','35'],[48,66,39,76,57,92,48,69,35,60,82,54]);
barChart('tools-bars',['SEARCH','STATUS','TICKET','POLICY','SCOPE'],[82,64,76,53,91]);

function statusTag(status) {
  const cls = status === 'Running' ? 'running' : status === 'Failed' || status === 'Cancelled' ? 'failed' : status === 'Awaiting approval' || status === 'Awaiting clarification' ? 'await' : status === 'Partial' ? 'partial' : '';
  return `<span class="status ${cls}">${status.toUpperCase()}</span>`;
}
function runRow(run) {
  return `<tr data-id="${run.id}"><td><span class="mono" style="color:#8da0b7">${run.id}</span><br><span style="display:inline-block;margin-top:4px">${escapeHtml(run.request)}</span></td><td>${statusTag(run.status)}</td><td class="mono">${run.duration}</td><td>${run.when}</td></tr>`;
}
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function renderRunTables() {
  document.querySelectorAll('.runrows').forEach(el => { el.innerHTML = runs.slice(0,4).map(runRow).join(''); });
  const query = $('runsearch')?.value.toLowerCase() ?? '';
  const status = $('statusfilter')?.value ?? 'all';
  const matches = runs.filter(r => (status === 'all' || r.status === status) && (!query || `${r.id} ${r.request}`.toLowerCase().includes(query)));
  if ($('allruns')) $('allruns').innerHTML = matches.length ? matches.map(runRow).join('') : '<tr><td colspan="4" class="empty">No matching runs.</td></tr>';
}
renderRunTables();

function renderTools() {
  const grid = $('toolcards');
  if (!grid) return;
  grid.innerHTML = toolDefs.map((tool, index) => {const registered=toolRegistry[tool.name]?.registered===true;const enabled=registered&&toolRegistry[tool.name]?.enabled;return `<div class="card toolcard"><div class="tooltop"><div class="toolglyph">${tool.icon}</div><button class="toggle ${enabled?'on':''}" data-tool="${index}" aria-label="Toggle ${tool.name}" aria-pressed="${Boolean(enabled)}" ${registered?'':'disabled title="No execution adapter is registered"'}></button></div><h3>${tool.name}</h3><p>${tool.description}</p><div class="toolmeta"><span class="pill">${tool.timeout}</span><span class="pill">${tool.scope}</span></div></div>`;}).join('');
  grid.querySelectorAll('.toggle').forEach(button => button.addEventListener('click', () => {
    const tool = toolDefs[Number(button.dataset.tool)]; tool.enabled = !tool.enabled;
    refreshToolRegistry();
    renderTools();
    const demoCount=toolDefs.filter(item=>item.enabled&&['knowledge_lookup','account_status'].includes(item.name)).length;
    $('tool-count').textContent = `${demoCount} DEMO READERS · 3 UNAVAILABLE · 1 PREVIEW`;
    toast(`${tool.name} ${tool.enabled ? 'enabled' : 'disabled'}`);
  }));
}
renderTools();

function showPage(id) {
  document.querySelectorAll('.page').forEach(page => {
    const active = page.id === `page-${id}`;
    page.classList.toggle('active', active);
    page.classList.remove('preview-changing');
    if (active) {
      // Restart the subtle dashboard transition whenever the user changes page.
      void page.offsetWidth;
      page.classList.add('preview-changing');
      window.setTimeout(() => page.classList.remove('preview-changing'), 650);
    }
  });
  document.querySelectorAll('.nav button').forEach(button => button.classList.toggle('active', button.dataset.page === id));
  $('crumb').textContent = id === 'chat' ? 'Agent Chat' : id[0].toUpperCase() + id.slice(1);
  window.scrollTo({top:0, behavior:'smooth'});
}
document.querySelectorAll('[data-page],[data-goto]').forEach(button => button.addEventListener('click', () => showPage(button.dataset.page || button.dataset.goto)));

document.querySelectorAll('.scene').forEach(scene => {
  let dragging = false, startX = 0, rotation = 0;
  scene.addEventListener('pointerdown', event => { dragging = true; startX = event.clientX; scene.setPointerCapture(event.pointerId); });
  scene.addEventListener('pointermove', event => { if (dragging) scene.querySelector('.bars')?.style.setProperty('--ry', `${rotation + (event.clientX-startX)*.12}deg`); });
  scene.addEventListener('pointerup', event => { if (dragging) rotation += (event.clientX-startX)*.12; dragging = false; });
});
setInterval(() => {
  const bars = $('overview-bars')?.querySelectorAll('.barwrap');
  if (!bars?.length || document.hidden) return;
  bars[Math.floor(Math.random()*bars.length)].style.setProperty('--h', `${35+Math.floor(Math.random()*62)}%`);
  $('kpi-requests').textContent = ++requestCount;
}, 3500);

function newRunId() { return `AG-${String(Date.now()).slice(-5)}`; }
function addTrace(title, detail, symbol='✓') {
  $('timeline').insertAdjacentHTML('beforeend', `<div class="step"><div class="stepmark">${symbol}</div><div><b>${escapeHtml(title)}</b><small>${escapeHtml(detail)}</small></div></div>`);
}
function setAnswer(html, feedback=true) {
  $('answer').innerHTML = html;
  $('feedback').classList.toggle('visible', feedback);
}
function finishRun(text, status, detail) {
  runs.unshift({id:activeRun, request:text, status, duration: status==='Succeeded'?'2.6s':'—', when:'Just now'});
  renderRunTables();
  $('pipeline-state').textContent = status.toUpperCase();
  if (detail) setAnswer(detail, status === 'Succeeded');
}
function persistConversation(userText, answerText, chatText=answerText) {
  const history = storage.get('history', []);
  history.unshift({request:userText, response:answerText, run:activeRun, at:new Date().toISOString()});
  storage.set('history', history.slice(0,8));
  renderHistory();
  if (activeSurface === 'chat') {
    clearChatReplyPending();
    appendChatMessage('agent', chatText);
    activeSurface = 'playground';
  }
}
function clearChatReplyPending() {
  chatReplyPending = false;
  $('chat-send')?.removeAttribute('aria-busy');
  $('chat-send')?.removeAttribute('disabled');
  renderChat();
}
async function keepChatReplyVisibleBriefly() {
  if (!chatReplyPending) return;
  const minimumVisibleMs = 520;
  const remaining = minimumVisibleMs - (performance.now() - chatReplyStartedAt);
  if (remaining > 0) await new Promise(resolve => window.setTimeout(resolve, remaining));
}
function appendChatMessage(role, text) {
  const chat=chatConversations.find(item=>item.id===activeConversationId);
  if(!chat)return;
  chat.messages.push({role,text,at:new Date().toISOString()});
  chat.messages=chat.messages.slice(-60);
  if(role==='user' && (!chat.title || chat.title==='New chat')) chat.title=text.trim().replace(/\s+/g,' ').slice(0,42)||'New chat';
  chat.updatedAt=new Date().toISOString();
  chatConversations=[chat,...chatConversations.filter(item=>item.id!==chat.id)];
  saveChatConversations();
  renderChatList();
  renderChat();
}
function saveChatConversations() {
  storage.set('chatConversations',chatConversations);
  storage.set('activeChatConversationId',activeConversationId);
}
function activeChat() { return chatConversations.find(item=>item.id===activeConversationId); }
function renderChatList() {
  const list=$('chat-list');
  if(!list)return;
  const query=($('chat-search')?.value||'').trim().toLowerCase();
  const matches=chatConversations.filter(chat=>!query||chat.title.toLowerCase().includes(query)||chat.messages.some(message=>message.text.toLowerCase().includes(query)));
  list.innerHTML=matches.length?matches.map(chat=>`<div class="chatlistrow ${chat.id===activeConversationId?'selected':''}" data-chat-row="${escapeHtml(chat.id)}"><button class="chatpick" data-chat-open="${escapeHtml(chat.id)}" title="Open ${escapeHtml(chat.title)}"><span class="chatpicktitle">${escapeHtml(chat.title)}</span><small>${chat.messages.length?`${chat.messages.length} messages`:'Empty chat'}</small></button><div class="chatrowactions"><button class="chatrowaction" data-chat-rename="${escapeHtml(chat.id)}" aria-label="Rename ${escapeHtml(chat.title)}" title="Rename chat">✎</button><button class="chatrowaction delete" data-chat-delete="${escapeHtml(chat.id)}" aria-label="Delete ${escapeHtml(chat.title)}" title="Delete chat">×</button></div></div>`).join(''):'<div class="chatlistempty">No matching chats.</div>';
  list.querySelectorAll('[data-chat-open]').forEach(button=>button.onclick=()=>selectChat(button.dataset.chatOpen));
  list.querySelectorAll('[data-chat-rename]').forEach(button=>button.onclick=event=>{event.stopPropagation();renameChat(button.dataset.chatRename);});
  list.querySelectorAll('[data-chat-delete]').forEach(button=>button.onclick=event=>{event.stopPropagation();deleteChat(button.dataset.chatDelete);});
}
function selectChat(id) {
  if(chatReplyPending){toast('Wait for the current reply to finish.');return;}
  if(!chatConversations.some(chat=>chat.id===id))return;
  activeConversationId=id;saveChatConversations();renderChatList();renderChat();
  $('chat-title').textContent=activeChat()?.title||'New chat';
}
function createChat() {
  if(chatReplyPending){toast('Wait for the current reply to finish.');return;}
  $('chat-search').value='';
  const now=new Date().toISOString();
  const chat={id:`chat-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,title:'New chat',createdAt:now,updatedAt:now,messages:[]};
  chatConversations.unshift(chat);activeConversationId=chat.id;saveChatConversations();renderChatList();renderChat();
  $('chat-title').textContent=chat.title;$('chat-input').focus();
}
function renameChat(id) {
  if(chatReplyPending){toast('Wait for the current reply to finish.');return;}
  const chat=chatConversations.find(item=>item.id===id);if(!chat)return;
  const title=window.prompt('Rename chat',chat.title);
  if(title===null)return;
  const cleanTitle=title.trim().replace(/\s+/g,' ').slice(0,64);
  if(!cleanTitle){toast('Chat name cannot be empty.');return;}
  chat.title=cleanTitle;chat.updatedAt=new Date().toISOString();saveChatConversations();renderChatList();
  if(id===activeConversationId)$('chat-title').textContent=cleanTitle;
}
function deleteChat(id) {
  if(chatReplyPending){toast('Wait for the current reply to finish.');return;}
  const chat=chatConversations.find(item=>item.id===id);if(!chat)return;
  if(!window.confirm(`Delete “${chat.title}”? This removes its messages from this browser.`))return;
  chatConversations=chatConversations.filter(item=>item.id!==id);
  if(!chatConversations.length){const now=new Date().toISOString();chatConversations=[{id:`chat-${Date.now()}`,title:'New chat',createdAt:now,updatedAt:now,messages:[]}];}
  if(activeConversationId===id){activeConversationId=chatConversations[0].id;$('chat-search').value='';}
  saveChatConversations();renderChatList();renderChat();$('chat-title').textContent=activeChat()?.title||'New chat';
}
function renderChat() {
  const chat=activeChat(), messages=chat?.messages||[], feed=$('chat-feed');
  if (!feed) return;
  $('chat-title').textContent=chat?.title||'New chat';
  if (!messages.length) {
    feed.innerHTML='<div class="bubble agent">Hi, I’m your workspace support agent. Ask me about setup guides, account status, or support. I’ll show when I use a tool and ask before consequential actions.<span class="bubblemeta">ORBIT AGENT · READY</span></div>';
    return;
  }
  const typing = chatReplyPending ? '<div class="bubble agent typing-bubble" role="status" aria-label="Agent is replying"><span>Agent is replying</span><span class="typing-dots" aria-hidden="true"><i></i><i></i><i></i></span></div>' : '';
  feed.innerHTML=messages.map(message=>`<div class="bubble ${message.role==='user'?'user':'agent'}">${escapeHtml(message.text)}<span class="bubblemeta">${message.role==='user'?'YOU':'ORBIT AGENT'} · ${new Date(message.at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span></div>`).join('')+typing;
  feed.scrollTop=feed.scrollHeight;
}
renderChatList();
renderChat();
function renderHistory() {
  const history = storage.get('history', []);
  $('history-list').innerHTML = history.length ? history.slice(0,6).map((item,i)=>`<button class="example historyitem" data-history="${i}" title="${escapeHtml(item.request)}">${escapeHtml(item.request)}</button>`).join('') : '<span class="hint">No saved requests yet.</span>';
  $('history-list').querySelectorAll('[data-history]').forEach(button => button.onclick=()=>{
    const item=history[Number(button.dataset.history)]; $('prompt').value=item.request;
    toast('Loaded a previous request into the composer.');
  });
}
renderHistory();

let pendingPlan = null;
let pendingReadOnlyOutcomes = [];

function traceTask(requestId, task, result, durationMs=0, executed=false) {
  const event=AgentCore.makeTraceEvent({requestId,taskId:task.id,tool:task.tool,status:result.status,durationMs,errorCategory:result.status==='error'?'tool_error':result.status==='unavailable'?'tool_unavailable':null});
  console.info('[agent-trace]',JSON.stringify({...event,execution:executed?'executed':'not_executed',data_source:result.data_source}));
  const marker=result.status==='success'?'✓':result.status==='unavailable'?'—':'!';
  addTrace(task.label,`${task.tool} · ${result.status} · source ${result.data_source}`,marker);
}

function buildTaskArguments(task,text) {
  if(task.tool==='knowledge_lookup')return {query:text};
  if(task.tool==='account_status')return {};
  if(task.tool==='create_ticket'){
    const match=text.match(/\b(?:for|about|regarding)\s+(?:the\s+)?(.+?)(?:[.!?]|$)/i);
    const summary=match?.[1]?.trim();
    return {summary:summary&&!/^(support ticket|ticket|issue|request)$/i.test(summary)?summary:''};
  }
  return {};
}

async function executeDemoTask(task,text) {
  const started=performance.now();
  const args=buildTaskArguments(task,text);
  const missing=AgentCore.missingRequiredInput(task.tool,args);
  let outcome;
  if(missing && (activePlan.registry[task.tool]?.registered || AgentCore.requiresConfirmation(task.tool))){
    outcome={task:activePlan.tasks.find(item=>item.id===task.id)||task,executed:false,execution_attempted:false,execution_completed:false,result:AgentCore.makeToolResult({status:'error',data_source:'unknown',result:{missing:missing.missing},message:missing.question||'Required information is missing.',limitations:['No tool was executed.']})};
  } else {
    outcome=await AgentCore.executeTask(activePlan,task,args,{requestText:text,requestId:activeRun},activeExecutionTrace);
  }
  const safeResult=AgentCore.wrapUntrustedToolData(outcome.result).result;
  outcome={...outcome,result:safeResult};
  if(!activeExecutionTrace.task_records.find(item=>item.task_id===task.id)?.result_status)AgentCore.recordExecutionOutcome(activeExecutionTrace,outcome);
  traceTask(activeRun,outcome.task,safeResult,performance.now()-started,outcome.executed);
  return outcome;
}

function renderReport(plan,outcomes,clarification=null) {
  if(clarification){
    console.info('[agent-summary]',JSON.stringify({request_id:activeRun,status:'awaiting_clarification',completed_task_ids:[],failed_task_ids:[],unavailable_task_ids:[],skipped_task_ids:plan.tasks.map(task=>task.id),error_category:'missing_required_input'}));
    const answer=`I need one detail before continuing: ${clarification}`;
    finishRun($('prompt').value,'Awaiting clarification',`<b style="color:var(--amber)">Clarification needed</b><br>${escapeHtml(answer)}<br>No consequential action was executed.`);
    persistConversation($('prompt').value,answer);return;
  }
  const summary=AgentCore.summarizeOutcomes(outcomes,activeExecutionTrace);
  console.info('[agent-execution-trace]',JSON.stringify(activeExecutionTrace));
  console.info('[agent-summary]',JSON.stringify({request_id:activeRun,status:summary.status,completed_task_ids:activeExecutionTrace.successful_results.map(item=>item.task_id),failed_task_ids:activeExecutionTrace.execution_failures.map(item=>item.task_id),unavailable_task_ids:[...activeExecutionTrace.unavailable_adapters,...activeExecutionTrace.unavailable_capabilities].map(item=>item.task_id),skipped_task_ids:activeExecutionTrace.task_records.filter(item=>!item.execution_attempted&&!item.result_status).map(item=>item.task_id),task_counts:{planned:activeExecutionTrace.task_records.length,usable:summary.usable_results,unavailable:summary.unavailable,failed:summary.failed,not_executed:summary.not_executed}}));
  const listText=items=>items.length?items.join(', '):'None';
  const usedText=listText(activeExecutionTrace.executed_tools);
  const successfulText=listText(activeExecutionTrace.successful_results.map(item=>`${item.tool} (${item.data_source})`));
  const unavailableAdapterText=listText(activeExecutionTrace.unavailable_adapters.map(item=>`${item.tool}: ${item.reason}`));
  const unavailableCapabilityText=listText(activeExecutionTrace.unavailable_capabilities.map(item=>`${item.tool} (${item.data_source}): ${item.message}`));
  const failureText=listText(activeExecutionTrace.execution_failures.map(item=>`${item.tool} (${item.data_source}): ${item.message}`));
  const planMarkup=plan.tasks.map(task=>`<li>${escapeHtml(task.label)} → <code>${escapeHtml(task.tool)}</code> <span class="pill">${escapeHtml(task.toolState)}</span></li>`).join('')||'<li>None</li>';
  const taskStateMarkup=activeExecutionTrace.task_records.map(record=>`<li><code>${escapeHtml(record.task_id)}</code>: ${record.registration}; selected ${record.selected?'yes':'no'}; attempted ${record.execution_attempted?'yes':'no'}; completed ${record.execution_completed?'yes':'no'}; result ${escapeHtml(record.result_status||'not returned')}; source ${escapeHtml(record.data_source||'unknown')}; live verification ${record.live_verification_performed?'performed':'not performed'}</li>`).join('');
  const traceMarkup=`<div class="trace-section"><h3>Execution trace</h3><p><b>Tasks planned</b></p><ul>${planMarkup}</ul><p><b>Per-task execution records</b></p><ul>${taskStateMarkup||'<li>None</li>'}</ul><p><b>Tools registered:</b> ${escapeHtml(listText(activeExecutionTrace.registered_tools))}</p><p><b>Tools selected:</b> ${escapeHtml(listText(activeExecutionTrace.selected_tools))}</p><p><b>Tools used (dispatch attempted):</b> ${escapeHtml(usedText)}</p><p><b>Successful results:</b> ${escapeHtml(successfulText)}</p><p><b>Unavailable adapters:</b> ${escapeHtml(unavailableAdapterText)}</p><p><b>Unavailable capabilities:</b> ${escapeHtml(unavailableCapabilityText)}</p><p><b>Execution failures:</b> ${escapeHtml(failureText)}</p><p><b>Completion rule:</b> ${escapeHtml(summary.completion_rule)}</p></div>`;
  const troubleshooting=AgentCore.buildTroubleshootingSections(plan,outcomes);
  let troubleshootingMarkup='';
  if(troubleshooting){
    const bulletList=items=>items.length?`<ul>${items.map(item=>`<li>${escapeHtml(item)}</li>`).join('')}</ul>`:'<p>None.</p>';
    troubleshootingMarkup=`<div class="trace-section"><h3>Sync troubleshooting</h3><p><b>Main problem:</b> ${escapeHtml(troubleshooting.mainProblem.summary)}</p><p><b>Verified results</b></p>${bulletList(troubleshooting.verifiedResults)}<p><b>Demo results</b></p>${bulletList(troubleshooting.demoResults)}<p><b>Other results (cached/unknown)</b></p>${bulletList(troubleshooting.otherResults)}<p><b>Possible causes</b> (not confirmed)</p>${bulletList(troubleshooting.possibleCauses)}<p><b>Recommended troubleshooting steps</b></p>${bulletList(troubleshooting.recommendedSteps)}<p><b>Checks unavailable</b></p>${bulletList(troubleshooting.unavailableChecks)}<p><b>Diagnostic failures</b></p>${bulletList(troubleshooting.failures)}${troubleshooting.followUpQuestion?`<p><b>Follow-up:</b> ${escapeHtml(troubleshooting.followUpQuestion)}</p>`:''}</div>`;
  }
  const runStatus=summary.status==='complete'?'Succeeded':summary.status==='partial'?'Partial':summary.status==='unavailable'?'Unavailable':summary.status==='not_executed'?'Not executed':'Failed';
  const answer=AgentCore.formatHumanResponse(plan,activeExecutionTrace,summary,troubleshooting);
  const answerMarkup=escapeHtml(answer).replace(/\n/g,'<br>');
  finishRun($('prompt').value,runStatus,`<p class="human-response">${answerMarkup}</p>${troubleshootingMarkup}${traceMarkup}`);
  persistConversation($('prompt').value,answer,answer);
}

async function demoAgent(text) {
  activeRun=newRunId();$('runid').textContent=activeRun;$('pipeline-state').textContent='PLANNING';$('timeline').innerHTML='';$('answer').textContent='';$('feedback').classList.remove('visible');
  const taskPlan=AgentCore.planRequest(text);
  activePlan=AgentCore.resolvePlan(taskPlan,toolRegistry);
  activeExecutionTrace=AgentCore.createExecutionTrace(activePlan);
  console.info('[agent-plan]',JSON.stringify({request_id:activeRun,task_plan:activePlan.tasks.map(task=>({task_id:task.id,task:task.label,tool:task.tool,registration:task.toolState,reason:task.toolReason})),planned_tools:activePlan.plannedTools}));
  console.info('[agent-trace]',JSON.stringify(activeExecutionTrace.events[1]));
  if(activePlan.mainProblem)addTrace('Main problem identified',activePlan.mainProblem.summary);
  addTrace('Request received',`Planned ${activePlan.tasks.length} task${activePlan.tasks.length===1?'':'s'}; selected ${activePlan.selectedTools.length} registered tool${activePlan.selectedTools.length===1?'':'s'}.`);
  if(!activePlan.inScope){
    await keepChatReplyVisibleBriefly();
    const answer='I can help with workspace setup guidance, account sync status, and support troubleshooting. I can’t reliably handle that request within this agent’s scope.';
    finishRun(text,'Failed',`<b style="color:var(--amber)">Outside this agent’s scope</b><br>${escapeHtml(answer)}`);persistConversation(text,answer);return;
  }
  const actionTask=activePlan.tasks.find(task=>AgentCore.requiresConfirmation(task.tool));
  if(actionTask){
    const args=buildTaskArguments(actionTask,text),missing=AgentCore.missingRequiredInput(actionTask.tool,args);
    if(missing && activePlan.registry[actionTask.tool]?.registered){
      await keepChatReplyVisibleBriefly();
      const clarification=missing.question||'Please provide the missing details.';
      const event=AgentCore.makeTraceEvent({requestId:activeRun,taskId:actionTask.id,tool:actionTask.tool,status:'error',durationMs:0,errorCategory:'missing_required_input'});console.info('[agent-trace]',JSON.stringify(event));
      addTrace('Clarification required',clarification,'!');renderReport(activePlan,[],clarification);return;
    }
  }
  $('pipeline-state').textContent='RUNNING';
  // Independent read-only checks run together. The confirmation gate remains ahead of any write.
  const readonlyTasks=activePlan.tasks.filter(task=>!AgentCore.requiresConfirmation(task.tool));
  const readonlyOutcomes=await Promise.all(readonlyTasks.map(task=>executeDemoTask(task,text)));
  await keepChatReplyVisibleBriefly();
  if(actionTask){
    pendingText=text;pendingPlan=activePlan;pendingReadOnlyOutcomes=readonlyOutcomes;$('modal').classList.add('show');$('pipeline-state').textContent='AWAITING APPROVAL';
    const event=AgentCore.makeTraceEvent({requestId:activeRun,taskId:actionTask.id,tool:actionTask.tool,status:'awaiting_confirmation',durationMs:0,errorCategory:'confirmation_required'});console.info('[agent-trace]',JSON.stringify(event));
    addTrace('Consequential action paused','create_ticket · approval required before any side effect.','!');
    setAnswer('<b style="color:#f5d28c">Approval needed</b><br>Read-only checks are listed above. The ticket tool has no live adapter; no ticket will be created by this demo.');
    if(activeSurface==='chat'){
      clearChatReplyPending();
      appendChatMessage('agent','I completed the available read-only checks. The ticket action requires your confirmation; this demo has no live ticket service, so approving will not create a ticket.');
    }
    return;
  }
  renderReport(activePlan,readonlyOutcomes);
}

async function resumeApprovedAction() {
  $('modal').classList.remove('show');
  const plan=pendingPlan,text=pendingText,outcomes=pendingReadOnlyOutcomes;
  pendingPlan=null;pendingReadOnlyOutcomes=[];
  if(!plan)return;
  const task=plan.tasks.find(item=>AgentCore.requiresConfirmation(item.tool));
  addTrace('User approved request','Consent recorded; checking registered adapter.');
  outcomes.push(await executeDemoTask(task,text));
  renderReport(plan,outcomes);
}
$('send').onclick=()=>{
  const text=$('prompt').value.trim();
  if(!text){toast('Enter a request first.');return;}
  demoAgent(text);
};
$('approve').onclick=()=>{resumeApprovedAction();};
$('reject').onclick=()=>{
  $('modal').classList.remove('show');
  const task=pendingPlan?.tasks.find(item=>AgentCore.requiresConfirmation(item.tool));
  if(task){
    const result=AgentCore.unavailableResult(task.tool,'User rejected the confirmation; no action was taken.');
    const outcome={task,result,executed:false};AgentCore.recordExecutionOutcome(activeExecutionTrace,outcome);
    traceTask(activeRun,task,result,0,false);pendingReadOnlyOutcomes.push(outcome);
  }
  const plan=pendingPlan,outcomes=pendingReadOnlyOutcomes;
  pendingPlan=null;pendingReadOnlyOutcomes=[];
  if(plan)renderReport(plan,outcomes);
};

function submitChat() {
  const text=$('chat-input').value.trim();
  if(!text){toast('Type a message first.');return;}
  if(chatReplyPending)return;
  activeSurface='chat';chatReplyPending=true;chatReplyStartedAt=performance.now();
  $('chat-send').setAttribute('aria-busy','true');$('chat-send').disabled=true;
  appendChatMessage('user',text);$('chat-input').value='';
  const vals=Array.from({length:5},()=>25+Math.floor(Math.random()*75));
  barChart('chat-bars',['ASK','PLAN','CHECK','TOOL','REPLY'],vals);
  $('prompt').value=text;$('send').click();
}
$('chat-send').onclick=submitChat;
$('chat-input').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();submitChat();}});
document.querySelectorAll('[data-chat-example]').forEach(button=>button.onclick=()=>{$('chat-input').value=button.dataset.chatExample;$('chat-input').focus();});
$('new-chat').onclick=createChat;
$('chat-search').addEventListener('input',renderChatList);

document.querySelectorAll('[data-example]').forEach(button=>button.onclick=()=>{$('prompt').value=button.dataset.example;$('prompt').focus();});
document.querySelectorAll('[data-rating]').forEach(button=>button.onclick=()=>{
  const feedback=storage.get('feedback',[]); feedback.unshift({run:activeRun,rating:button.dataset.rating,at:new Date().toISOString()});storage.set('feedback',feedback.slice(0,100));
  $('feedback').innerHTML='<span>Thanks — feedback saved in this browser.</span>';toast('Feedback recorded.');
});
$('clear-history').onclick=()=>{storage.set('history',[]);renderHistory();toast('Conversation context cleared from this browser.');};
$('run-evals').onclick=()=>{
  const cases=[
    {text:'Find the API setup guide',tools:['knowledge_lookup']},
    {text:'Check account sync status',tools:['account_status']},
    {text:'Create a support ticket for login issue',tools:['knowledge_lookup','create_ticket']},
    {text:'Check account sync, verify workspace setup, and explain permission issues.',tools:['account_status','workspace_setup','knowledge_lookup']},
    {text:'Check my account status, workspace configuration, and permissions.',tools:['account_status','workspace_setup','permission_check']},
    {text:'Tell me a joke about space',tools:[]}
  ];
  const passed=cases.filter(c=>JSON.stringify(AgentCore.planRequest(c.text).requiredTools)===JSON.stringify(c.tools)).length;
  $('eval-result').textContent=`${passed}/${cases.length} checks passed · multi-task routing and scope`;
  toast('Evaluation examples checked against the deterministic planner.');
};

$('runsearch').oninput=renderRunTables;$('statusfilter').onchange=renderRunTables;
$('clearfilters').onclick=()=>{$('runsearch').value='';$('statusfilter').value='all';renderRunTables();};
$('turns').oninput=event=>$('turnval').textContent=event.target.value;
$('calls').oninput=event=>$('callval').textContent=event.target.value;
document.querySelectorAll('.policyrow .toggle').forEach(button=>button.onclick=()=>{button.classList.toggle('on');button.setAttribute('aria-pressed',button.classList.contains('on'));});
$('save-settings').onclick=()=>{storage.set('settings',{instructions:$('instructions').value,maxTurns:Number($('turns').value),maxToolCalls:Number($('calls').value)});toast('Draft configuration saved in this browser demo.');};
document.querySelectorAll('button:not([data-page]):not([data-goto]):not(.toggle):not(#send):not(#save-settings):not(#clearfilters):not(#approve):not(#reject):not(#clear-history):not(#run-evals):not([data-rating]):not([data-example]):not([data-history]):not(.iconbtn)').forEach(button=>{if(!button.onclick)button.onclick=()=>toast('This control is a visual prototype.');});

function toast(message){const element=$('toast');element.textContent=message;element.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>element.classList.remove('show'),2400);}
