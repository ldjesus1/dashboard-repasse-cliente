import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'

const SUPABASE_URL = window.SUPABASE_URL || 'COLE_SUPABASE_URL_AQUI'
const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || 'COLE_SUPABASE_ANON_KEY_AQUI'
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
const $ = id => document.getElementById(id)
const BRL = v => (Number(v)||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})
const NUM = v => (Number(v)||0).toLocaleString('pt-BR')
let state = { rows: [], balances: [], payments: [], params: null, session: null, view: 'resumo', isAdmin: false }

function msg(t){ $('loginMsg').textContent=t||'' }
async function init(){
  const { data } = await supabase.auth.getSession()
  if (data.session) await enter(data.session)
}
async function enter(session){
  state.session = session
  $('loginBox').classList.add('hidden'); $('app').classList.remove('hidden')
  $('userBox').innerHTML = `<button id="logoutBtn">Sair</button>`
  $('logoutBtn').onclick = async()=>{ await supabase.auth.signOut(); location.reload() }
  // Todo usuário autenticado/cadastrado tem acesso completo às funções do dashboard.
  state.isAdmin = !!session.user
  await loadAll()
}
async function login(){
  msg('')
  const { data, error } = await supabase.auth.signInWithPassword({ email: $('email').value, password: $('password').value })
  if(error){ msg(error.message); return }
  await enter(data.session)
}
function filters(){ return { month:$('monthFilter').value, company:$('companyFilter').value, channel:$('channelFilter').value } }
function filtered(){ const f=filters(); return state.rows.filter(r=>(!f.month||r.month===f.month)&&(!f.company||r.company===f.company)&&(!f.channel||r.channel===f.channel)) }
function summarize(rows){ const orders=new Set(rows.map(r=>r.marketplace_order_id)); const skus=new Set(rows.filter(r=>!r.cost_found).map(r=>r.sku)); return { fat:rows.reduce((a,r)=>a+Number(r.gross_value||0),0), rep:rows.reduce((a,r)=>a+Number(r.transfer_total_value||0),0), ped:orders.size, itens:rows.reduce((a,r)=>a+Number(r.quantity||0),0), sem:skus.size } }
function fillFilters(){
  const fill=(id, vals, first)=>{ const cur=$(id).value; $(id).innerHTML=`<option value="">${first}</option>`+[...new Set(vals)].sort().map(v=>`<option>${v}</option>`).join(''); $(id).value=cur }
  fill('monthFilter', state.rows.map(r=>r.month), 'Todos os meses')
  fill('companyFilter', state.rows.map(r=>r.company), 'Todas empresas')
  fill('channelFilter', state.rows.map(r=>r.channel), 'Todos canais')
}
async function fetchAllSalesItems(){
  const pageSize = 1000
  let from = 0
  let all = []
  while (true) {
    const to = from + pageSize - 1
    const { data, error } = await supabase
      .from('sales_items')
      .select('*')
      .order('sale_date', { ascending: false })
      .range(from, to)
    if (error) throw error
    const chunk = data || []
    all = all.concat(chunk)
    if (chunk.length < pageSize) break
    from += pageSize
    if (from > 100000) break
  }
  return all
}

async function loadAll(){
  try {
    $('view').textContent = 'Carregando dados atualizados...'
    const [rows, params, balances, payments] = await Promise.all([
      fetchAllSalesItems(),
      supabase.from('pricing_params').select('*').eq('active',true).order('created_at',{ascending:false}).limit(1),
      supabase.from('v_repayment_balance').select('*').order('period_key',{ascending:false}),
      supabase.from('payments').select('*').order('paid_at',{ascending:false}).limit(500)
    ])
    state.rows = rows || []
    state.params = (params.data||[])[0] || null
    state.balances = balances.data || []
    state.payments = payments.data || []
    fillFilters(); render()
  } catch (e) {
    $('view').textContent = e.message || String(e)
  }
}
function setCards(rows){ const s=summarize(rows); $('fat').textContent=BRL(s.fat); $('rep').textContent=BRL(s.rep); $('ped').textContent=NUM(s.ped); $('itens').textContent=NUM(s.itens); $('sem').textContent=NUM(s.sem) }
function group(rows,key){ const m=new Map(); rows.forEach(r=>{const k=r[key]||'—'; if(!m.has(k))m.set(k,[]); m.get(k).push(r)}); return [...m.entries()].map(([name,rs])=>({name, ...summarize(rs)})).sort((a,b)=>b.rep-a.rep) }
function table(rows){ return `<div style="overflow:auto"><table><thead><tr><th>Data</th><th>Empresa</th><th>Canal</th><th>Pedido</th><th>SKU</th><th class="num">Qtd</th><th class="num">Venda</th><th class="num">Repasse</th><th>Custo</th></tr></thead><tbody>${rows.slice(0,1000).map(r=>`<tr><td>${r.sale_date||''}</td><td>${r.company}</td><td>${r.channel}</td><td>${r.marketplace_order_id||''}</td><td>${r.sku}</td><td class="num">${NUM(r.quantity)}</td><td class="num">${BRL(r.gross_value)}</td><td class="num">${BRL(r.transfer_total_value)}</td><td>${r.cost_found?'ok':'<span class="warn">sem custo</span>'}</td></tr>`).join('')}</tbody></table></div>` }

function unitSale(r){ return Number(r.gross_unit_value || (Number(r.gross_value||0)/Number(r.quantity||1)) || 0) }
function costAlerts(rows){
  return rows.map(r=>{
    const vendaUnit = unitSale(r)
    const custo = Number(r.cost_unit || 0)
    const repUnit = Number(r.transfer_unit_value || 0)
    const costPct = vendaUnit > 0 && custo > 0 ? custo / vendaUnit : null
    const repPct = vendaUnit > 0 && repUnit > 0 ? repUnit / vendaUnit : null
    const alerts = []
    let severity = 0
    if(!r.cost_found){ alerts.push('SKU sem custo'); severity=Math.max(severity,3) }
    if(r.cost_found && custo <= 0){ alerts.push('Custo zerado/negativo'); severity=Math.max(severity,3) }
    if(r.cost_found && vendaUnit >= 20 && custo > 0 && custo < 1){ alerts.push('Custo menor que R$ 1 em venda acima de R$ 20'); severity=Math.max(severity,3) }
    if(costPct !== null && costPct < 0.05){ alerts.push('Custo < 5% do valor vendido unitário'); severity=Math.max(severity,3) }
    else if(costPct !== null && costPct < 0.10){ alerts.push('Custo entre 5% e 10% do valor vendido unitário'); severity=Math.max(severity,2) }
    if(repPct !== null && repPct < 0.20){ alerts.push('Repasse unitário < 20% do valor vendido unitário'); severity=Math.max(severity,3) }
    else if(repPct !== null && repPct < 0.30){ alerts.push('Repasse unitário entre 20% e 30% do valor vendido unitário'); severity=Math.max(severity,2) }
    return {...r, vendaUnit, costPct, repPct, alerts, severity}
  }).filter(r=>r.alerts.length).sort((a,b)=>b.severity-a.severity || (Number(b.gross_value||0)-Number(a.gross_value||0)))
}
function renderAlertas(rows){
  const alerts = costAlerts(rows)
  const crit = alerts.filter(a=>a.severity>=3).length
  const warn = alerts.filter(a=>a.severity===2).length
  $('view').innerHTML = `<h2>Alertas de custo</h2><p class="sub">Regras para encontrar possível erro na planilha de custos: SKU sem custo, custo zerado, custo muito baixo contra valor vendido e repasse unitário baixo demais.</p><div class="cards"><div class="card"><div class="label">Alertas críticos</div><div class="val bad">${NUM(crit)}</div></div><div class="card"><div class="label">Alertas atenção</div><div class="val warn">${NUM(warn)}</div></div><div class="card"><div class="label">Total alertas</div><div class="val">${NUM(alerts.length)}</div></div></div><div style="overflow:auto"><table><thead><tr><th>Sev.</th><th>Empresa</th><th>Canal</th><th>Pedido</th><th>SKU</th><th>Descrição</th><th class="num">Venda unit.</th><th class="num">Custo</th><th class="num">Custo/Venda</th><th class="num">Repasse unit.</th><th>Motivo</th></tr></thead><tbody>${alerts.slice(0,1500).map(r=>`<tr><td>${r.severity>=3?'<span class="bad">Crítico</span>':'<span class="warn">Atenção</span>'}</td><td>${r.company}</td><td>${r.channel}</td><td>${r.marketplace_order_id||''}</td><td>${r.sku}</td><td>${r.description||''}</td><td class="num">${BRL(r.vendaUnit)}</td><td class="num">${r.cost_found?BRL(r.cost_unit):'—'}</td><td class="num">${r.costPct===null?'—':(r.costPct*100).toFixed(1)+'%'}</td><td class="num">${BRL(r.transfer_unit_value)}</td><td>${r.alerts.join('; ')}</td></tr>`).join('')}</tbody></table></div>`
}

function renderResumo(rows){ const byCompany=group(rows,'company'); $('view').innerHTML=`<h2>Resumo por empresa</h2>${tableSummary(byCompany)}` }
function tableSummary(rows){ return `<div style="overflow:auto"><table><thead><tr><th>Nome</th><th class="num">Faturamento</th><th class="num">Repasse</th><th class="num">Pedidos</th><th class="num">Itens</th><th class="num">SKUs sem custo</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${r.name}</td><td class="num">${BRL(r.fat)}</td><td class="num">${BRL(r.rep)}</td><td class="num">${NUM(r.ped)}</td><td class="num">${NUM(r.itens)}</td><td class="num">${NUM(r.sem)}</td></tr>`).join('')}</tbody></table></div>` }
function renderPagamentos(){
  const f=filters();
  const bs=state.balances.filter(r=>(!f.month||r.period_key===f.month)&&(!f.company||r.company===f.company));
  const ps=state.payments.filter(r=>(!f.month||r.period_key===f.month)&&(!f.company||r.company===f.company));
  const form = `<div class="warn">Lançamento de pagamento bloqueado. Esta tela é somente para consulta de saldos e histórico.</div>`;
  $('view').innerHTML=`<h2>Pagamentos / Saldo Devedor</h2>${form}<h3>Saldos</h3><div style="overflow:auto"><table><thead><tr><th>Mês</th><th>Empresa</th><th class="num">Faturamento</th><th class="num">Repasse devido</th><th class="num">Pago</th><th class="num">Saldo</th><th>Status</th></tr></thead><tbody>${bs.map(r=>`<tr><td>${r.period_key}</td><td>${r.company}</td><td class="num">${BRL(r.gross_value)}</td><td class="num">${BRL(r.amount_due)}</td><td class="num">${BRL(r.amount_paid_company)}</td><td class="num">${BRL(r.balance_company)}</td><td>${r.status}</td></tr>`).join('')}</tbody></table></div><h3>Histórico de pagamentos</h3><div style="overflow:auto"><table><thead><tr><th>Data</th><th>Mês</th><th>Empresa</th><th>Forma</th><th class="num">Valor</th><th>Obs.</th></tr></thead><tbody>${ps.map(r=>`<tr><td>${(r.paid_at||'').slice(0,10)}</td><td>${r.period_key||''}</td><td>${r.company||'Geral'}</td><td>${r.method||''}</td><td class="num">${BRL(r.amount)}</td><td>${r.note||''}</td></tr>`).join('')}</tbody></table></div>`;
}
async function savePayment(){
  const row={period_key:$('payPeriod').value, company:$('payCompany').value||null, amount:Number($('payAmount').value), method:$('payMethod').value, note:$('payNote').value||null};
  if(!row.period_key || !row.amount){ alert('Informe mês e valor.'); return }
  const {error}=await supabase.from('payments').insert(row);
  if(error) alert(error.message); else { alert('Pagamento registrado.'); await loadAll() }
}

function renderParams(){ const p=state.params||{}; const disabled=state.isAdmin?'':'disabled'; $('view').innerHTML=`<h2>Parâmetros de cálculo</h2><p class="sub">Cliente visualiza travado. Admin altera com senha/login.</p><div class="params"><div><label>Imposto %</label><input id="tax" ${disabled} value="${p.tax_percent??14}"></div><div><label>Custo operacional %</label><input id="op" ${disabled} value="${p.operational_percent??44}"></div><div><label>Margem %</label><input id="margin" ${disabled} value="${p.margin_percent??5}"></div><div><label>Percentual líquido</label><input disabled value="${p.net_percent??37}"></div></div>${state.isAdmin?'<button id="saveParams" class="primary">Salvar parâmetros</button>':'<div class="warn">Somente admin pode alterar.</div>'}`; if(state.isAdmin) $('saveParams').onclick=saveParams }
async function saveParams(){ const body={ active:true, tax_percent:Number($('tax').value), operational_percent:Number($('op').value), margin_percent:Number($('margin').value), note:'Alterado pelo dashboard' }; const {error}=await supabase.from('pricing_params').insert(body); if(error) alert(error.message); else { alert('Parâmetros salvos. A próxima atualização recalcula os dados.'); await loadAll() } }
function render(){ const rows=filtered(); setCards(rows); if(state.view==='resumo')renderResumo(rows); if(state.view==='vendas')$('view').innerHTML=table(rows); if(state.view==='skus')$('view').innerHTML=table(rows.filter(r=>!r.cost_found)); if(state.view==='alertas')renderAlertas(rows); if(state.view==='pagamentos')renderPagamentos(); if(state.view==='params')renderParams(); document.querySelectorAll('.tabs button').forEach(b=>b.classList.remove('active')); const active={resumo:'tabResumo',vendas:'tabVendas',skus:'tabSkus',alertas:'tabAlertas',pagamentos:'tabPagamentos',params:'tabParams'}[state.view]; $(active)?.classList.add('active') }
$('loginBtn').onclick=login; $('refreshBtn').onclick=loadAll; ['monthFilter','companyFilter','channelFilter'].forEach(id=>$(id).onchange=render); $('tabResumo').onclick=()=>{state.view='resumo';render()}; $('tabVendas').onclick=()=>{state.view='vendas';render()}; $('tabSkus').onclick=()=>{state.view='skus';render()}; $('tabAlertas').onclick=()=>{state.view='alertas';render()}; $('tabPagamentos').onclick=()=>{state.view='pagamentos';render()}; $('tabParams').onclick=()=>{state.view='params';render()};
init()
