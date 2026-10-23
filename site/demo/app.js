// Demo app: a simple, read-only DoorLoop-style app with sample data, for trying product tours.
// Element labels (data-cy, data-intercom-target, aria-label) match the real app, so tours carry over.
(function () {
  'use strict';
  if (window.DEMO_NOT_FOUND) return;

  const ROOT = window.DEMO_ROOT; // e.g. "/product-tour-layer/demo"
  const D = window.DEMO_DATA;
  const OFF = 'This is a demo: creating and editing are turned off.';

  // ---------- helpers ----------
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const money = (n) => (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const day = (s) => new Date(s + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const byId = (list, id) => list.find((x) => x.id === id);
  const initials = (name) => name.split(' ').map((w) => w[0]).join('');
  const unitOf = (tenant) => byId(D.units, tenant.unitId);
  const propertyOf = (unit) => byId(D.properties, unit.propertyId);
  const unitLabel = (unit) => `${propertyOf(unit).name} · ${unit.name}`;
  const link = (to, text, attrs = '') => `<a href="${ROOT}${to}" data-link ${attrs}>${text}</a>`;
  const pill = (text) => {
    const kind = /^(Paid|Active|Occupied|Current|Completed)$/.test(text) ? 'good'
      : /^(Late|High|Vacant)$/.test(text) ? 'bad'
      : /^(Expiring soon|In progress|Medium|Invited)$/.test(text) ? 'warn' : '';
    return `<span class="pill ${kind}">${esc(text)}</span>`;
  };

  const path = () => (location.pathname.slice(ROOT.length).replace(/\/$/, '') || '/');
  function go(to) {
    history.pushState({}, '', ROOT + to);
    render();
  }

  let toastTimer;
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 2600);
  }

  // ---------- shell ----------
  const NAV = [
    { label: 'Overview', to: '/home', cy: 'SideMenu-Main-Overview', ico: '⌂' },
    { group: 'Rentals', target: 'nav-side-menu-main-rentals', ico: '▦', items: [
      { label: 'Properties', to: '/properties', cy: 'SideMenu-Rentals-Properties' },
      { label: 'Units', to: '/units', cy: 'SideMenu-Rentals-Units' },
    ] },
    { group: 'Leasing', target: 'nav-side-menu-main-leasing', ico: '✎', items: [
      { label: 'Leases', to: '/leases', cy: 'SideMenu-Leasing-Leases' },
    ] },
    { group: 'People', target: 'nav-side-menu-main-people', ico: '☺', items: [
      { label: 'Tenants', to: '/tenants', cy: 'SideMenu-People-Tenants' },
      { label: 'Vendors', to: '/vendors', cy: 'SideMenu-People-Vendors' },
    ] },
    { group: 'Tasks & maintenance', target: 'nav-side-menu-main-tasks', ico: '✓', items: [
      { label: 'All tasks', to: '/tasks', cy: 'SideMenu-Tasks-AllTasks' },
    ] },
    { group: 'Accounting', target: 'nav-side-menu-main-accounting', ico: '$', items: [
      { label: 'Transactions', to: '/transactions', cy: 'SideMenu-Accounting-Transactions' },
    ] },
    { label: 'Reports', to: '/reports', cy: 'SideMenu-Main-Reports', ico: '▤' },
  ];
  const openGroups = new Set();
  let lastSection = null;

  document.getElementById('app').innerHTML = `
    <div class="app">
      <aside class="side">
        <div class="brand"><span class="logo">◧</span>doorloop<span class="tag">demo</span></div>
        <button class="search-trigger" data-cy="global-search-trigger" aria-label="Search">Search <kbd>⌘K</kbd></button>
        <button class="create-new" data-cy="SideMenu-CreateNewMenu-Button">+ Create new</button>
        <nav class="nav" id="nav"></nav>
        <div class="side-foot">
          ${link('/settings', 'Settings', 'data-cy="SideMenu-Footer-Settings"')}
          <button class="help" data-cy="TrainingHubV2-DockButton" aria-label="Help & training">?</button>
        </div>
      </aside>
      <div class="main-clip">
        <div class="banner">
          <span>Demo app with made-up data for trying product tours. Nothing can be created or saved.</span>
          <a href="${ROOT.replace(/\/demo$/, '')}/">All tours</a>
        </div>
        <main class="main" id="main"></main>
      </div>
    </div>
    <div class="menu" id="createMenu" hidden>
      ${['Lease', 'Tenant', 'Property', 'Receive payment', 'Task', 'Bill'].map((x) => `<button data-off>${x}</button>`).join('')}
    </div>
    <div class="search-overlay" id="search" hidden>
      <div class="search-box">
        <input aria-label="Search everything" placeholder="Search tenants, properties, units…">
        <div class="search-results" id="searchResults"></div>
      </div>
    </div>
    <div class="toast" id="toast" role="status" hidden></div>`;

  const main = document.getElementById('main');

  function renderNav() {
    const p = path();
    const section = NAV.find((n) => n.items && n.items.some((i) => p.startsWith(i.to)));
    // Opening a page opens its section, like DoorLoop; sections you open or close yourself stay that way.
    if (section && section !== lastSection) openGroups.add(section.group);
    lastSection = section;
    const row = (i, sub) =>
      `<a href="${ROOT}${i.to}" data-link class="nav-row ${p === i.to || p.startsWith(i.to + '/') ? 'active' : ''}" data-cy="${i.cy}">${sub ? '' : `<span class="ico">${i.ico}</span>`}${esc(i.label)}</a>`;
    document.getElementById('nav').innerHTML = NAV.map((n) => {
      if (!n.items) return row(n);
      const open = openGroups.has(n.group);
      return `<div class="group ${open ? 'open' : ''}">
        <button class="nav-row" data-group="${esc(n.group)}" data-intercom-target="${n.target}" aria-expanded="${open}">
          <span class="ico">${n.ico}</span>${esc(n.group)}<span class="chev">›</span>
        </button>
        <div class="group-body"><div class="group-items">${n.items.map((i) => row(i, true)).join('')}</div></div>
      </div>`;
    }).join('');
  }

  // ---------- list pages ----------
  // A title, a toolbar (search, filter, columns, export) and a table whose rows open a detail page.
  function listPage({ title, sub, action, columns, rows, href, filter }) {
    const html = `
      <div class="page-head">
        <h1 data-cy="DetailScreen-ScreenTitle">${esc(title)} <span class="count">${rows.length}</span></h1>
        ${action ? `<button class="btn primary" data-off>+ ${esc(action)}</button>` : ''}
      </div>
      ${sub ? `<p class="sub">${esc(sub)}</p>` : ''}
      <div class="toolbar">
        <input aria-label="Search" placeholder="Search or filter...">
        ${filter ? '<button class="btn" aria-label="Filter">Filter</button>' : ''}
        <span class="spacer"></span>
        <button class="btn icon" aria-label="Columns" title="Columns">▥</button>
        <button class="btn icon" aria-label="Export" title="Export">⤓</button>
      </div>
      ${filter ? `<div class="chips" data-filters hidden>${['All', ...filter.values].map((v, i) => `<button class="chip ${i === 0 ? 'on' : ''}" data-value="${esc(v)}">${esc(v)}</button>`).join('')}</div>` : ''}
      <table>
        <thead><tr>${columns.map((c) => `<th class="${c.num ? 'num' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead>
        <tbody></tbody>
      </table>`;

    function mount(root) {
      const tbody = root.querySelector('tbody');
      const input = root.querySelector('input[aria-label="Search"]');
      let chosen = 'All';
      const draw = () => {
        const q = input.value.trim().toLowerCase();
        const shown = rows.filter((r) =>
          (!q || columns.map((c) => c.text(r)).join(' ').toLowerCase().includes(q)) &&
          (chosen === 'All' || filter.value(r) === chosen));
        tbody.innerHTML = shown.length
          ? shown.map((r) => `<tr data-cy="list-engine-row" ${href ? `data-href="${href(r)}"` : ''}>${columns.map((c) => `<td class="${c.num ? 'num' : ''}">${c.html ? c.html(r) : esc(c.text(r))}</td>`).join('')}</tr>`).join('')
          : `<tr><td class="empty" colspan="${columns.length}">No matches.</td></tr>`;
      };
      input.oninput = draw;
      const filterBtn = root.querySelector('button[aria-label="Filter"]');
      if (filterBtn) {
        const bar = root.querySelector('[data-filters]');
        filterBtn.onclick = () => (bar.hidden = !bar.hidden);
        bar.onclick = (e) => {
          const chip = e.target.closest('.chip');
          if (!chip) return;
          chosen = chip.dataset.value;
          bar.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === chip));
          draw();
        };
      }
      root.querySelector('[aria-label="Columns"]').onclick = () => toast('Choosing columns is turned off in the demo.');
      root.querySelector('[aria-label="Export"]').onclick = () => toast('Export is turned off in the demo.');
      draw();
    }
    return { html, mount };
  }

  const pages = {
    tenants: () => listPage({
      title: 'Tenants', action: 'New lease', sub: 'Everyone renting from you, across all properties.',
      rows: D.tenants, href: (t) => `/tenants/${t.id}`,
      filter: { values: ['Owes money', 'Paid up'], value: (t) => (t.balance > 0 ? 'Owes money' : 'Paid up') },
      columns: [
        { label: 'Tenant', text: (t) => t.name + ' ' + unitLabel(unitOf(t)), html: (t) => `<div class="who"><span class="avatar">${initials(t.name)}</span><div>${esc(t.name)}<small>${esc(unitLabel(unitOf(t)))}</small></div></div>` },
        { label: 'Status', text: () => 'Current', html: () => pill('Current') },
        { label: 'Email', text: (t) => t.email },
        { label: 'Phone', text: (t) => t.phone },
        { label: 'Balance', num: true, text: (t) => money(t.balance), html: (t) => `<span class="${t.balance > 0 ? 'owed' : ''}">${money(t.balance)}</span>` },
      ],
    }),
    properties: () => listPage({
      title: 'Properties', action: 'New property', rows: D.properties, href: (p) => `/properties/${p.id}`,
      filter: { values: [...new Set(D.properties.map((p) => p.type))], value: (p) => p.type },
      columns: [
        { label: 'Property', text: (p) => p.name + ' ' + p.address, html: (p) => `<div class="who"><span class="avatar">▦</span><div>${esc(p.name)}<small>${esc(p.address)}</small></div></div>` },
        { label: 'Type', text: (p) => p.type },
        { label: 'Units', num: true, text: (p) => D.units.filter((u) => u.propertyId === p.id).length },
        { label: 'Occupancy', num: true, text: (p) => { const us = D.units.filter((u) => u.propertyId === p.id); return Math.round((100 * us.filter((u) => u.tenantId).length) / us.length) + '%'; } },
      ],
    }),
    units: () => listPage({
      title: 'Units', action: 'New unit', rows: D.units, href: (u) => `/properties/${u.propertyId}`,
      filter: { values: ['Occupied', 'Vacant'], value: (u) => u.status },
      columns: [
        { label: 'Unit', text: (u) => u.name },
        { label: 'Property', text: (u) => propertyOf(u).name },
        { label: 'Beds / baths', text: (u) => `${u.beds} bd · ${u.baths} ba` },
        { label: 'Status', text: (u) => u.status, html: (u) => pill(u.status) },
        { label: 'Tenant', text: (u) => (u.tenantId ? byId(D.tenants, u.tenantId).name : '—') },
        { label: 'Rent', num: true, text: (u) => money(u.rent) },
      ],
    }),
    leases: () => listPage({
      title: 'Leases', action: 'New lease', rows: D.leases, href: (l) => `/leases/${l.id}`,
      filter: { values: ['Active', 'Expiring soon'], value: (l) => l.status },
      columns: [
        { label: 'Lease', text: (l) => unitLabel(byId(D.units, l.unitId)) },
        { label: 'Tenant', text: (l) => byId(D.tenants, l.tenantId).name },
        { label: 'Term', text: (l) => `${day(l.start)} – ${day(l.end)}` },
        { label: 'Status', text: (l) => l.status, html: (l) => pill(l.status) },
        { label: 'Rent', num: true, text: (l) => money(l.rent) },
        { label: 'Balance', num: true, text: (l) => money(l.balance), html: (l) => `<span class="${l.balance > 0 ? 'owed' : ''}">${money(l.balance)}</span>` },
      ],
    }),
    vendors: () => listPage({
      title: 'Vendors', action: 'New vendor', rows: D.vendors,
      columns: [
        { label: 'Vendor', text: (v) => v.name },
        { label: 'Trade', text: (v) => v.trade },
        { label: 'Phone', text: (v) => v.phone },
        { label: 'Open jobs', num: true, text: (v) => v.openJobs },
      ],
    }),
    tasks: () => listPage({
      title: 'All tasks', action: 'New task', rows: D.tasks,
      filter: { values: ['Open', 'In progress', 'Completed'], value: (k) => k.status },
      columns: [
        { label: 'Task', text: (k) => k.title },
        { label: 'Where', text: (k) => `${byId(D.properties, k.propertyId).name}${k.unit !== '—' ? ' · ' + k.unit : ''}` },
        { label: 'Priority', text: (k) => k.priority, html: (k) => pill(k.priority) },
        { label: 'Status', text: (k) => k.status, html: (k) => pill(k.status) },
        { label: 'Due', text: (k) => day(k.due) },
        { label: 'Vendor', text: (k) => (k.vendorId ? byId(D.vendors, k.vendorId).name : 'Unassigned') },
      ],
    }),
    transactions: () => listPage({
      title: 'Transactions', action: 'New transaction', rows: D.transactions,
      filter: { values: ['Payment received', 'Bill paid'], value: (x) => x.type },
      columns: [
        { label: 'Date', text: (x) => day(x.date) },
        { label: 'Type', text: (x) => x.type },
        { label: 'From / to', text: (x) => x.who },
        { label: 'Amount', num: true, text: (x) => money(x.amount), html: (x) => `<span class="${x.amount < 0 ? 'owed' : ''}">${money(x.amount)}</span>` },
      ],
    }),
  };

  // ---------- other pages ----------
  function overview() {
    const owing = D.tenants.filter((t) => t.balance > 0);
    const occupied = D.units.filter((u) => u.tenantId).length;
    const pct = Math.round((100 * occupied) / D.units.length);
    const openTasks = D.tasks.filter((k) => k.status !== 'Completed');
    const recent = D.payments.filter((p) => p.status === 'Paid').slice(0, 6);
    return { html: `
      <div class="page-head"><h1 data-cy="DetailScreen-ScreenTitle">Overview</h1></div>
      <p class="sub">What needs your attention across your portfolio.</p>
      <div class="widgets">
        <section class="widget" data-cy="Widget-dashboards.thingsToDo">
          <h3>Things to do</h3>
          <div class="todo">${link('/tenants', 'Past due leases')}<strong>${owing.length}</strong></div>
          <div class="todo">${link('/leases', 'Leases expiring soon')}<strong>${D.leases.filter((l) => l.status === 'Expiring soon').length}</strong></div>
          <div class="todo">${link('/tasks', 'Open tasks')}<strong>${openTasks.length}</strong></div>
          <div class="todo">${link('/units', 'Vacant units')}<strong>${D.units.length - occupied}</strong></div>
        </section>
        <section class="widget" data-cy="Widget-dashboards.leasesWithOutstandingBalances">
          <h3>Leases with outstanding balances</h3>
          ${owing.map((t) => `<div class="list-row"><div class="who"><span class="avatar">${initials(t.name)}</span><div>${link('/tenants/' + t.id, esc(t.name))}<small>${esc(unitLabel(unitOf(t)))}</small></div></div><span class="owed">${money(t.balance)}</span></div>`).join('')}
        </section>
        <section class="widget" data-cy="Widget-dashboards.recentPaymentsReceived">
          <h3>Recent payments received</h3>
          ${recent.map((p) => { const t = byId(D.tenants, p.tenantId); return `<div class="list-row"><span>${esc(t.name)}<br><small style="color:var(--muted)">${day(p.date)} · ${p.method}</small></span><strong>${money(p.amount)}</strong></div>`; }).join('')}
        </section>
        <section class="widget" data-cy="Widget-dashboards.tasksNext7Days">
          <h3>Tasks: next 7 days</h3>
          ${openTasks.map((k) => `<div class="list-row"><span>${esc(k.title)}<br><small style="color:var(--muted)">${esc(byId(D.properties, k.propertyId).name)} · due ${day(k.due)}</small></span>${pill(k.priority)}</div>`).join('')}
        </section>
        <section class="widget" data-cy="Widget-dashboards.occupancyRate">
          <h3>Occupancy rate</h3>
          <div class="donut" style="background: conic-gradient(var(--navy) 0 ${pct}%, #e7e8ec ${pct}% 100%)"><span>${pct}%</span></div>
          <p style="text-align:center;color:var(--muted);margin:0">${occupied} of ${D.units.length} units occupied</p>
        </section>
      </div>` };
  }

  function tenantPage(id) {
    const t = byId(D.tenants, id);
    if (!t) return notFound();
    const unit = unitOf(t);
    const lease = byId(D.leases, t.leaseId);
    const pays = D.payments.filter((p) => p.tenantId === t.id);
    const tabs = {
      Overview: `<div class="cards">
          <div class="card" data-cy="Tenant-Balance"><h3>Balance</h3><div class="big-number ${t.balance > 0 ? 'owed' : ''}">${money(t.balance)}</div><p style="color:var(--muted);margin:6px 0 0">${t.balance > 0 ? 'Past due since Oct 1' : 'All paid up'}</p></div>
          <div class="card"><h3>Contact</h3><dl><dt>Email</dt><dd>${esc(t.email)}</dd><dt>Phone</dt><dd>${esc(t.phone)}</dd><dt>Portal</dt><dd>${pill(t.portal)}</dd></dl></div>
          <div class="card"><h3>Unit</h3><dl><dt>Property</dt><dd>${link('/properties/' + unit.propertyId, esc(propertyOf(unit).name))}</dd><dt>Unit</dt><dd>${esc(unit.name)} · ${unit.beds} bd · ${unit.baths} ba</dd><dt>Rent</dt><dd>${money(unit.rent)} / month</dd></dl></div>
        </div>`,
      Lease: `<div class="card" style="max-width:520px"><h3>Current lease</h3><dl>
          <dt>Term</dt><dd>${day(lease.start)} – ${day(lease.end)}</dd><dt>Rent</dt><dd>${money(lease.rent)}</dd>
          <dt>Status</dt><dd>${pill(lease.status)}</dd></dl><p style="margin:12px 0 0">${link('/leases/' + lease.id, 'Open lease →')}</p></div>`,
      Payments: `<table><thead><tr><th>Date</th><th>Method</th><th>Status</th><th class="num">Amount</th></tr></thead><tbody>
          ${pays.map((p) => `<tr><td>${day(p.date)}</td><td>${p.method}</td><td>${pill(p.status)}</td><td class="num">${money(p.amount)}</td></tr>`).join('')}</tbody></table>`,
    };
    return {
      html: `
        <p class="sub" style="margin:0 0 10px">${link('/tenants', '← Tenants')}</p>
        <div class="page-head">
          <div class="who"><span class="avatar big">${initials(t.name)}</span><div><h1 data-cy="DetailScreen-ScreenTitle">${esc(t.name)}</h1><span style="color:var(--muted)">${esc(unitLabel(unit))}</span> ${pill('Current')}</div></div>
          <div class="actions"><button class="btn" data-off>Send message</button><button class="btn primary" data-off>Receive payment</button></div>
        </div>
        <div class="tabs" role="tablist">${Object.keys(tabs).map((k, i) => `<button class="tab" role="tab" aria-selected="${i === 0}" data-tab="${k}">${k}</button>`).join('')}</div>
        <div data-tab-body>${tabs.Overview}</div>`,
      mount(root) {
        root.querySelector('[role=tablist]').onclick = (e) => {
          const tab = e.target.closest('[role=tab]');
          if (!tab) return;
          root.querySelectorAll('[role=tab]').forEach((b) => b.setAttribute('aria-selected', b === tab));
          root.querySelector('[data-tab-body]').innerHTML = tabs[tab.dataset.tab];
        };
      },
    };
  }

  function propertyPage(id) {
    const p = byId(D.properties, id);
    if (!p) return notFound();
    const us = D.units.filter((u) => u.propertyId === id);
    const occupied = us.filter((u) => u.tenantId);
    const ts = D.tasks.filter((k) => k.propertyId === id && k.status !== 'Completed');
    return { html: `
      <p class="sub" style="margin:0 0 10px">${link('/properties', '← Properties')}</p>
      <div class="page-head"><h1 data-cy="DetailScreen-ScreenTitle">${esc(p.name)}</h1><button class="btn primary" data-off>+ New unit</button></div>
      <p class="sub">${esc(p.address)} · ${esc(p.type)}</p>
      <div class="stats" data-cy="Property-Stats">
        <div class="stat"><span>Units</span><strong>${us.length}</strong></div>
        <div class="stat"><span>Occupied</span><strong>${occupied.length}</strong></div>
        <div class="stat"><span>Vacant</span><strong>${us.length - occupied.length}</strong></div>
        <div class="stat"><span>Monthly rent</span><strong>${money(occupied.reduce((s, u) => s + u.rent, 0))}</strong></div>
      </div>
      <h2>Units</h2>
      <table data-cy="Property-Units"><thead><tr><th>Unit</th><th>Beds / baths</th><th>Status</th><th>Tenant</th><th class="num">Rent</th></tr></thead><tbody>
        ${us.map((u) => `<tr data-cy="list-engine-row" ${u.tenantId ? `data-href="/tenants/${u.tenantId}"` : ''}><td>${esc(u.name)}</td><td>${u.beds} bd · ${u.baths} ba</td><td>${pill(u.status)}</td><td>${u.tenantId ? esc(byId(D.tenants, u.tenantId).name) : '—'}</td><td class="num">${money(u.rent)}</td></tr>`).join('')}
      </tbody></table>
      <h2>Open tasks</h2>
      ${ts.length ? ts.map((k) => `<div class="list-row"><span>${esc(k.title)} <small style="color:var(--muted)">· ${esc(k.unit)}</small></span>${pill(k.status)}</div>`).join('') : '<p class="empty">No open tasks.</p>'}` };
  }

  function leasePage(id) {
    const l = byId(D.leases, id);
    if (!l) return notFound();
    const unit = byId(D.units, l.unitId);
    const t = byId(D.tenants, l.tenantId);
    const charges = D.payments.filter((p) => p.tenantId === t.id);
    return { html: `
      <p class="sub" style="margin:0 0 10px">${link('/leases', '← Leases')}</p>
      <div class="page-head"><h1 data-cy="DetailScreen-ScreenTitle">${esc(unitLabel(unit))}</h1><div class="actions"><button class="btn" data-off>Renew lease</button><button class="btn primary" data-off>Post charge</button></div></div>
      <p class="sub">Tenant: ${link('/tenants/' + t.id, esc(t.name))} · ${pill(l.status)}</p>
      <div class="stats">
        <div class="stat"><span>Rent</span><strong>${money(l.rent)}</strong></div>
        <div class="stat"><span>Starts</span><strong>${day(l.start)}</strong></div>
        <div class="stat"><span>Ends</span><strong>${day(l.end)}</strong></div>
        <div class="stat" data-cy="Lease-Balance"><span>Balance</span><strong class="${l.balance > 0 ? 'owed' : ''}">${money(l.balance)}</strong></div>
      </div>
      <h2>Charges and payments</h2>
      <table><thead><tr><th>Date</th><th>Description</th><th>Status</th><th class="num">Amount</th></tr></thead><tbody>
        ${charges.map((c) => `<tr><td>${day(c.date)}</td><td>Monthly rent</td><td>${pill(c.status)}</td><td class="num">${money(c.amount)}</td></tr>`).join('')}
      </tbody></table>` };
  }

  const reports = () => ({ html: `
    <div class="page-head"><h1 data-cy="DetailScreen-ScreenTitle">Reports</h1></div>
    <p class="sub">Pick a report to run.</p>
    <div class="cards">${D.reports.map((r) => `<button class="card" data-report="${esc(r.name)}"><h3>${esc(r.name)}</h3><span class="pill">${esc(r.group)}</span><p style="color:var(--muted);margin:8px 0 0">${esc(r.about)}</p></button>`).join('')}</div>`,
    mount(root) { root.querySelectorAll('[data-report]').forEach((b) => (b.onclick = () => toast(`Running “${b.dataset.report}” is turned off in the demo.`))); },
  });

  const settings = () => ({ html: `
    <div class="page-head"><h1 data-cy="DetailScreen-ScreenTitle">Settings</h1></div>
    <p class="sub">Company, users, and accounting preferences.</p>
    <div class="cards">${['Company information', 'Users & roles', 'Rent & late fees', 'Tenant portal', 'Bank accounts', 'Communications'].map((s) => `<button class="card" data-off><h3>${s}</h3><p style="color:var(--muted);margin:0">Manage ${s.toLowerCase()}.</p></button>`).join('')}</div>` });

  const notFound = () => ({ html: `<h1>Page not found</h1><p>${link('/home', 'Go to Overview')}</p>` });

  function route(p) {
    let m;
    if (p === '/' || p === '/home') return overview();
    if (pages[p.slice(1)]) return pages[p.slice(1)]();
    if ((m = p.match(/^\/tenants\/(\w+)$/))) return tenantPage(m[1]);
    if ((m = p.match(/^\/properties\/(\w+)$/))) return propertyPage(m[1]);
    if ((m = p.match(/^\/leases\/(\w+)$/))) return leasePage(m[1]);
    if (p === '/reports') return reports();
    if (p === '/settings') return settings();
    return notFound();
  }

  function render() {
    if (path() === '/') history.replaceState({}, '', ROOT + '/home' + location.search);
    renderNav();
    const view = route(path());
    main.innerHTML = view.html;
    if (view.mount) view.mount(main);
    main.scrollTop = 0;
    document.title = (main.querySelector('h1')?.textContent.trim() || 'Demo') + ' · DoorLoop Demo';
  }

  // ---------- global interactions ----------
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-link]');
    if (a && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
      e.preventDefault();
      closeOverlays();
      return go(a.pathname.slice(ROOT.length));
    }
    const row = e.target.closest('tr[data-href]');
    if (row && !e.target.closest('a')) return go(row.dataset.href);
    const group = e.target.closest('[data-group]');
    if (group) {
      const g = group.dataset.group;
      openGroups.has(g) ? openGroups.delete(g) : openGroups.add(g);
      return renderNav();
    }
    if (e.target.closest('[data-off]')) {
      closeOverlays();
      return toast(OFF);
    }
    if (e.target.closest('[data-cy="SideMenu-CreateNewMenu-Button"]')) return toggleCreate(e.target.closest('button'));
    if (e.target.closest('[data-cy="global-search-trigger"]')) return openSearch();
    if (e.target.closest('[data-cy="TrainingHubV2-DockButton"]')) return toast('Help & training would open here.');
    if (e.target.id === 'search') return closeOverlays();
    if (!e.target.closest('#createMenu')) document.getElementById('createMenu').hidden = true;
  });
  window.addEventListener('popstate', render);
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openSearch();
    }
    if (e.key === 'Escape') closeOverlays();
  });

  function toggleCreate(btn) {
    const menu = document.getElementById('createMenu');
    const r = btn.getBoundingClientRect();
    Object.assign(menu.style, { left: r.left + 'px', top: r.bottom + 6 + 'px' });
    menu.hidden = !menu.hidden;
  }
  function closeOverlays() {
    document.getElementById('createMenu').hidden = true;
    document.getElementById('search').hidden = true;
  }

  function openSearch() {
    const overlay = document.getElementById('search');
    const input = overlay.querySelector('input');
    const results = document.getElementById('searchResults');
    const all = [
      ...D.tenants.map((t) => ({ to: '/tenants/' + t.id, label: t.name, kind: 'Tenant' })),
      ...D.properties.map((p) => ({ to: '/properties/' + p.id, label: p.name, kind: 'Property' })),
      ...D.units.map((u) => ({ to: '/properties/' + u.propertyId, label: unitLabel(u), kind: 'Unit' })),
      ...D.vendors.map((v) => ({ to: '/vendors', label: v.name, kind: 'Vendor' })),
    ];
    const draw = () => {
      const q = input.value.trim().toLowerCase();
      const hits = all.filter((x) => !q || x.label.toLowerCase().includes(q)).slice(0, 8);
      results.innerHTML = hits.length
        ? hits.map((x) => `<a href="${ROOT}${x.to}" data-link>${esc(x.label)} <small>${x.kind}</small></a>`).join('')
        : '<p class="empty">No results.</p>';
    };
    input.value = '';
    input.oninput = draw;
    draw();
    overlay.hidden = false;
    input.focus();
  }

  render();

  // Real tours, run by the same engine the extension uses. Not inside the tour builder, which draws its own.
  if (window.self === window.top) fetch('tours.json', { cache: 'no-store' })
    .then((r) => r.json())
    .then(({ tours }) => window.TourLayer.init({ tours, basePath: ROOT }))
    .catch((e) => console.warn('[demo] tours not loaded', e));
})();
