// Sample data for the demo app. Everything here is made up.
window.DEMO_DATA = (function () {
  const properties = [
    { id: 'p1', name: 'Maple Court Apartments', address: '1200 Maple Ave, Austin, TX', type: 'Multi-family' },
    { id: 'p2', name: 'Riverside Lofts', address: '45 River Rd, Austin, TX', type: 'Multi-family' },
    { id: 'p3', name: 'Oak Street Duplex', address: '88 Oak St, Round Rock, TX', type: 'Duplex' },
    { id: 'p4', name: 'Harbor View Condos', address: '300 Harbor Dr, Austin, TX', type: 'Condo' },
  ];

  const people = [
    'Jordan Lee', 'Priya Shah', 'Marcus Bell', 'Ana Torres', 'Sam Okafor', 'Lena Fischer',
    'Diego Ramos', 'Hannah Kim', 'Tomás Silva', 'Grace Wu', 'Owen Carter', 'Nadia Haddad',
  ];

  // [property, unit, beds, baths, rent, tenant index or null]
  const unitRows = [
    ['p1', '101', 1, 1, 1250, 0], ['p1', '102', 2, 1, 1550, 1], ['p1', '103', 2, 2, 1650, 2],
    ['p1', '201', 1, 1, 1275, 3], ['p1', '202', 2, 1, 1575, null], ['p1', '203', 3, 2, 1950, 4],
    ['p2', 'A', 1, 1, 1800, 5], ['p2', 'B', 1, 1, 1800, 6], ['p2', 'C', 2, 2, 2400, null],
    ['p3', 'Upper', 3, 2, 2100, 7], ['p3', 'Lower', 2, 1, 1700, 8],
    ['p4', '4A', 2, 2, 2600, 9], ['p4', '4B', 2, 2, 2650, 10], ['p4', '5A', 3, 2, 3200, 11],
  ];
  const balances = [1250, 0, 450, 0, 75, 0, 1800, 0, 320, 0, 0, 2600];

  const units = unitRows.map(([propertyId, name, beds, baths, rent, t], i) => ({
    id: 'u' + (i + 1), propertyId, name, beds, baths, rent,
    tenantId: t === null ? null : 't' + (t + 1),
    status: t === null ? 'Vacant' : 'Occupied',
  }));

  const tenants = people.map((name, i) => {
    const unit = units.find((u) => u.tenantId === 't' + (i + 1));
    return {
      id: 't' + (i + 1), name,
      email: name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(' ', '.') + '@example.com',
      phone: '(512) 555-' + String(1000 + i * 137).slice(-4),
      unitId: unit.id, leaseId: 'l' + (i + 1),
      balance: balances[i],
      portal: i % 3 === 2 ? 'Invited' : 'Active',
    };
  });

  const leases = tenants.map((t, i) => {
    const unit = units.find((u) => u.id === t.unitId);
    const startMonth = (i % 12) + 1;
    return {
      id: 'l' + (i + 1), unitId: unit.id, tenantId: t.id, rent: unit.rent, balance: t.balance,
      start: `2025-${String(startMonth).padStart(2, '0')}-01`,
      end: `2026-${String(startMonth).padStart(2, '0')}-${startMonth === 2 ? '28' : '30'}`,
      status: i === 3 || i === 9 ? 'Expiring soon' : 'Active',
    };
  });

  const payments = tenants.flatMap((t, i) =>
    ['2026-10-01', '2026-09-01', '2026-08-01'].map((date, k) => ({
      id: `pay-${i}-${k}`, tenantId: t.id, date, amount: units.find((u) => u.id === t.unitId).rent,
      method: k === 1 && i % 4 === 0 ? 'Check' : 'ACH',
      status: k === 0 && t.balance > 0 ? 'Late' : 'Paid',
    }))
  );

  const vendors = [
    { id: 'v1', name: 'Bright Spark Electric', trade: 'Electrical', phone: '(512) 555-0142', openJobs: 1 },
    { id: 'v2', name: 'BlueLine Plumbing', trade: 'Plumbing', phone: '(512) 555-0188', openJobs: 2 },
    { id: 'v3', name: 'GreenLeaf Landscaping', trade: 'Landscaping', phone: '(512) 555-0110', openJobs: 0 },
    { id: 'v4', name: 'CoolAir HVAC', trade: 'HVAC', phone: '(512) 555-0173', openJobs: 1 },
  ];

  const tasks = [
    { id: 'k1', title: 'Leaking kitchen faucet', propertyId: 'p1', unit: '102', priority: 'High', status: 'Open', due: '2026-10-25', vendorId: 'v2' },
    { id: 'k2', title: 'AC not cooling', propertyId: 'p4', unit: '4B', priority: 'High', status: 'In progress', due: '2026-10-24', vendorId: 'v4' },
    { id: 'k3', title: 'Replace hallway light', propertyId: 'p2', unit: '—', priority: 'Low', status: 'Open', due: '2026-10-30', vendorId: 'v1' },
    { id: 'k4', title: 'Move-out inspection', propertyId: 'p1', unit: '202', priority: 'Medium', status: 'Open', due: '2026-10-27', vendorId: null },
    { id: 'k5', title: 'Trim front hedges', propertyId: 'p3', unit: '—', priority: 'Low', status: 'Completed', due: '2026-10-15', vendorId: 'v3' },
    { id: 'k6', title: 'Clogged bathroom drain', propertyId: 'p2', unit: 'B', priority: 'Medium', status: 'Open', due: '2026-10-26', vendorId: 'v2' },
  ];

  const transactions = [
    ...payments.filter((p) => p.date === '2026-10-01' && p.status === 'Paid').map((p) => ({
      id: 'tx-' + p.id, date: p.date, type: 'Payment received', who: tenants.find((t) => t.id === p.tenantId).name, amount: p.amount,
    })),
    { id: 'tx-b1', date: '2026-10-12', type: 'Bill paid', who: 'BlueLine Plumbing', amount: -340 },
    { id: 'tx-b2', date: '2026-10-08', type: 'Bill paid', who: 'CoolAir HVAC', amount: -890 },
    { id: 'tx-b3', date: '2026-10-05', type: 'Bill paid', who: 'GreenLeaf Landscaping', amount: -220 },
  ].sort((a, b) => b.date.localeCompare(a.date));

  const reports = [
    { name: 'Rent roll', group: 'Leasing', about: 'Every unit, its tenant, rent, and lease dates.' },
    { name: 'Unpaid rent', group: 'Leasing', about: 'Balances owed, grouped by how late they are.' },
    { name: 'Occupancy', group: 'Rentals', about: 'Occupied and vacant units over time.' },
    { name: 'Profit and loss', group: 'Accounting', about: 'Income and expenses by property.' },
    { name: 'Balance sheet', group: 'Accounting', about: 'Assets, liabilities, and equity.' },
    { name: 'Open tasks', group: 'Maintenance', about: 'Work orders by status and vendor.' },
  ];

  return { properties, units, tenants, leases, payments, vendors, tasks, transactions, reports };
})();
