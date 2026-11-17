'use strict';

// Fills an EMPTY database with sample data so you can click around.
//   npm run seed-demo
// Logins created:  founder@demo.com / demo1234   and   cofounder@demo.com / demo1234

const { row, rows, insert, tx, setSetting, hashPassword } = require('./db');

if (row('SELECT COUNT(*) AS n FROM users').n > 0) {
  console.error('The database already has users. Demo data is only added to a fresh, empty database.');
  console.error('To start over, stop the app and delete the data/ folder first.');
  process.exit(1);
}

const tz = 'Asia/Kolkata';
const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
const day = (n) => {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

tx(() => {
  setSetting('business_name', 'Shubh Utsav Events');
  const roleId = (name) => row('SELECT id FROM roles WHERE name = ?', name).id;

  const founder = insert('users', {
    name: 'Rohan Mehta', login: 'founder@demo.com', phone: '9876500001',
    password_hash: hashPassword('demo1234'), role_id: roleId('Founder'),
  });
  const cofounder = insert('users', {
    name: 'Priya Sharma', login: 'cofounder@demo.com', phone: '9876500002',
    password_hash: hashPassword('demo1234'), role_id: roleId('Co-founder'),
  });
  const staff = insert('users', {
    name: 'Aman Verma', login: 'aman@demo.com', phone: '9876500003',
    password_hash: hashPassword('demo1234'), role_id: roleId('Coordinator'),
  });

  const V = {};
  for (const [key, v] of Object.entries({
    caterer: { name: 'Annapurna Caterers', category: 'Catering', contact_person: 'Suresh Agarwal', phone: '9811000001', city: 'Jaipur', rate_notes: 'Veg ₹650/plate, Non-veg ₹850/plate', rating: 5 },
    decor: { name: 'Gulmohar Decor', category: 'Decoration', contact_person: 'Imran Khan', phone: '9811000002', city: 'Jaipur', rate_notes: 'Mandap from ₹1.2L, stage from ₹60k', rating: 4 },
    photo: { name: 'Frame Story Studio', category: 'Photography', contact_person: 'Neha Kapoor', phone: '9811000003', city: 'Jaipur', rate_notes: '₹45k/day candid + traditional', rating: 5 },
    dj: { name: 'DJ Vicky & Sound', category: 'DJ & Sound', contact_person: 'Vicky', phone: '9811000004', city: 'Jaipur', rate_notes: '₹25k/night incl. sound', rating: 4 },
    light: { name: 'Roshni Lights', category: 'Lighting', contact_person: 'Mahesh', phone: '9811000005', city: 'Jaipur', rate_notes: 'Fairy lights ₹15k, full venue ₹40k', rating: 4 },
    tent: { name: 'Raj Tent House', category: 'Tent & Furniture', contact_person: 'Rajendra Singh', phone: '9811000006', city: 'Jaipur', rate_notes: 'Chairs ₹20 each, round tables ₹150', rating: 3 },
    mehendi: { name: 'Henna by Sana', category: 'Mehendi Artist', contact_person: 'Sana', phone: '9811000007', city: 'Jaipur', rate_notes: 'Bride ₹11k, guests ₹200/hand', rating: 5 },
    band: { name: 'Shree Ram Band', category: 'Band & Dhol', contact_person: 'Kishan', phone: '9811000008', city: 'Jaipur', rate_notes: '₹35k for baraat', rating: 4 },
    florist: { name: 'Petal Point Florist', category: 'Florist', contact_person: 'Ritu', phone: '9811000009', city: 'Jaipur', rate_notes: 'Varmala ₹4k/pair', rating: 4 },
  })) V[key] = insert('vendors', { ...v, whatsapp: v.phone });

  const W = {};
  for (const [key, w] of Object.entries({
    ramesh: { name: 'Ramesh Kumar', skill: 'Supervisor', phone: '9922000001', daily_wage: 1500 },
    sunil: { name: 'Sunil Yadav', skill: 'Decorator', phone: '9922000002', daily_wage: 900 },
    manoj: { name: 'Manoj Saini', skill: 'Decorator', phone: '9922000003', daily_wage: 900 },
    deepak: { name: 'Deepak Meena', skill: 'Electrician', phone: '9922000004', daily_wage: 1100 },
    arjun: { name: 'Arjun Prajapat', skill: 'Helper', phone: '9922000005', daily_wage: 700 },
    vikas: { name: 'Vikas Jangid', skill: 'Helper', phone: '9922000006', daily_wage: 700 },
    salim: { name: 'Salim Qureshi', skill: 'Helper', phone: '9922000007', daily_wage: 700 },
    gopal: { name: 'Gopal Sharma', skill: 'Waiter', phone: '9922000008', daily_wage: 800 },
    kailash: { name: 'Kailash Bairwa', skill: 'Waiter', phone: '9922000009', daily_wage: 800 },
    raju: { name: 'Raju Gurjar', skill: 'Driver', phone: '9922000010', daily_wage: 1000 },
  })) W[key] = insert('workers', { ...w, city: 'Jaipur' });

  const ev = (e) => insert('events', { created_by: founder, ...e });
  const wedding = ev({
    title: 'Aditi & Karan Wedding', type: 'Wedding', status: 'confirmed', client_name: 'Mr. Anil Gupta', client_phone: '9001100001',
    start_date: day(9), end_date: day(10), start_time: '18:00', venue: 'Rambagh Gardens, Jaipur', guests: 450,
    package_amount: 1850000, lead_user_id: founder, notes: 'Bride wants pastel theme. Baraat from Hotel Clarks at 7pm.',
  });
  const mehendi = ev({
    title: 'Aditi & Karan Mehendi', type: 'Mehendi', status: 'confirmed', client_name: 'Mr. Anil Gupta', client_phone: '9001100001',
    start_date: day(8), start_time: '12:00', venue: 'Gupta Residence, C-Scheme', guests: 120, package_amount: 240000, lead_user_id: cofounder,
  });
  const prewed = ev({
    title: 'Neha & Vivek Pre-wedding Shoot', type: 'Pre-wedding', status: 'confirmed', client_name: 'Vivek Jain', client_phone: '9001100002',
    start_date: day(3), start_time: '06:00', venue: 'Nahargarh Fort', guests: 4, package_amount: 95000, lead_user_id: cofounder,
    notes: 'Sunrise shoot. Need permission letter from fort office.',
  });
  const bday = ev({
    title: "Kabir's 1st Birthday", type: 'Birthday', status: 'in_progress', client_name: 'Sneha Arora', client_phone: '9001100003',
    start_date: day(1), start_time: '17:00', venue: 'Hotel Marigold Banquet', guests: 80, package_amount: 160000, lead_user_id: cofounder,
    notes: 'Jungle theme. Cake from client side.',
  });
  ev({
    title: 'Sharma Anniversary Dinner', type: 'Anniversary', status: 'enquiry', client_name: 'Rakesh Sharma', client_phone: '9001100004',
    start_date: day(24), venue: 'TBD', guests: 60, package_amount: 0,
  });
  const past = ev({
    title: 'Mittal Engagement', type: 'Engagement', status: 'completed', client_name: 'Pooja Mittal', client_phone: '9001100005',
    start_date: day(-12), start_time: '19:00', venue: 'Fairmont Jaipur', guests: 200, package_amount: 520000, lead_user_id: founder,
  });

  const book = (event_id, vendor_id, service, agreed_amount, status) => insert('event_vendors', { event_id, vendor_id, service, agreed_amount, status });
  book(wedding, V.caterer, 'Dinner buffet 450 pax', 340000, 'confirmed');
  book(wedding, V.decor, 'Mandap + stage + entrance', 420000, 'confirmed');
  book(wedding, V.photo, 'Photo + video, 2 days', 90000, 'confirmed');
  book(wedding, V.light, 'Full venue lighting', 40000, 'requested');
  book(wedding, V.band, 'Baraat band + dhol', 35000, 'requested');
  book(wedding, V.florist, 'Varmala + car decor', 12000, 'confirmed');
  book(mehendi, V.mehendi, 'Bride + 40 guests', 27000, 'confirmed');
  book(mehendi, V.dj, 'Afternoon DJ', 18000, 'confirmed');
  book(prewed, V.photo, 'Pre-wedding shoot, 1 day', 45000, 'confirmed');
  book(bday, V.decor, 'Jungle theme decor', 38000, 'confirmed');
  book(bday, V.dj, 'Kids DJ + games host', 15000, 'confirmed');
  book(bday, V.caterer, 'Snacks + dinner 80 pax', 52000, 'confirmed');
  book(past, V.decor, 'Ring ceremony stage', 85000, 'done');
  book(past, V.caterer, 'Dinner 200 pax', 150000, 'done');

  const shift = (event_id, worker, work_date, duty, shiftTime, attendance = 'pending') => insert('event_workers', {
    event_id, worker_id: W[worker], work_date, duty, shift: shiftTime,
    wage: row('SELECT daily_wage FROM workers WHERE id = ?', W[worker]).daily_wage, attendance,
  });
  for (const w of ['ramesh', 'sunil', 'manoj', 'deepak', 'arjun', 'vikas', 'salim']) shift(wedding, w, day(9), w === 'ramesh' ? 'In-charge' : 'Setup', '8am – 11pm');
  for (const w of ['ramesh', 'arjun', 'vikas']) shift(wedding, w, day(10), 'Teardown', '9am – 4pm');
  for (const w of ['sunil', 'arjun', 'gopal']) shift(mehendi, w, day(8), 'Setup & serving', '9am – 6pm');
  for (const w of ['raju', 'arjun']) shift(prewed, w, day(3), w === 'raju' ? 'Drive crew' : 'Props', '4am – 11am');
  for (const w of ['sunil', 'manoj', 'deepak', 'gopal', 'kailash']) shift(bday, w, day(1), 'Decor & serving', '11am – 11pm');
  for (const w of ['ramesh', 'sunil', 'manoj', 'deepak', 'arjun', 'gopal']) shift(past, w, day(-12), 'Full event', '10am – 12am', w === 'arjun' ? 'absent' : 'present');

  const pay = (p) => insert('payments', { created_by: founder, method: 'bank', ...p });
  pay({ event_id: wedding, direction: 'in', party_type: 'client', amount: 600000, paid_on: day(-40), reference: 'Advance' });
  pay({ event_id: wedding, direction: 'in', party_type: 'client', amount: 400000, paid_on: day(-10), method: 'upi' });
  pay({ event_id: wedding, direction: 'out', party_type: 'vendor', vendor_id: V.decor, amount: 150000, paid_on: day(-9), reference: 'Advance' });
  pay({ event_id: wedding, direction: 'out', party_type: 'vendor', vendor_id: V.caterer, amount: 100000, paid_on: day(-7) });
  pay({ event_id: mehendi, direction: 'in', party_type: 'client', amount: 120000, paid_on: day(-10), method: 'upi' });
  pay({ event_id: prewed, direction: 'in', party_type: 'client', amount: 95000, paid_on: day(-5), method: 'upi' });
  pay({ event_id: prewed, direction: 'out', party_type: 'vendor', vendor_id: V.photo, amount: 20000, paid_on: day(-4), method: 'upi' });
  pay({ event_id: bday, direction: 'in', party_type: 'client', amount: 80000, paid_on: day(-6), method: 'upi', created_by: cofounder });
  pay({ event_id: past, direction: 'in', party_type: 'client', amount: 520000, paid_on: day(-11) });
  pay({ event_id: past, direction: 'out', party_type: 'vendor', vendor_id: V.decor, amount: 85000, paid_on: day(-10) });
  pay({ event_id: past, direction: 'out', party_type: 'vendor', vendor_id: V.caterer, amount: 110000, paid_on: day(-10) });
  for (const w of ['ramesh', 'sunil', 'manoj']) {
    pay({ event_id: past, direction: 'out', party_type: 'worker', worker_id: W[w], method: 'cash', paid_on: day(-11),
      amount: row('SELECT daily_wage FROM workers WHERE id = ?', W[w]).daily_wage });
  }

  const task = (t) => insert('tasks', { created_by: founder, ...t });
  task({ title: 'Confirm lighting quote with Roshni Lights', event_id: wedding, assigned_to: cofounder, due_date: day(2) });
  task({ title: 'Get fort shoot permission letter', event_id: prewed, assigned_to: cofounder, due_date: day(1) });
  task({ title: 'Collect balance payment from Gupta ji', event_id: wedding, assigned_to: founder, due_date: day(5) });
  task({ title: 'Send final guest seating plan to caterer', event_id: wedding, assigned_to: staff, due_date: day(6) });
  task({ title: 'Pick up balloons & jungle props', event_id: bday, assigned_to: staff, due_date: day(0) });
  task({ title: 'Share mehendi menu with client', event_id: mehendi, assigned_to: cofounder, due_date: day(4), done: 1, done_at: new Date().toISOString() });
  task({ title: 'Call Sharma ji for anniversary venue options', assigned_to: founder, due_date: day(3) });

  insert('event_notes', { event_id: wedding, user_id: cofounder, body: 'Spoke to Gulmohar — they can do the pastel mandap but need final colour swatches by Friday.' });
  insert('event_notes', { event_id: wedding, user_id: founder, body: 'Gupta ji wants 2 extra live counters. I said we will revise the quote.' });
  insert('contact_log', { event_id: wedding, party_type: 'vendor', vendor_id: V.light, party_name: 'Roshni Lights', channel: 'whatsapp', user_id: cofounder, message: 'Hi Mahesh, please share the full venue lighting quote for 18th.' });

  const log = (user_id, summary, sensitive = 0) => insert('activity', { user_id, action: 'create', summary, sensitive });
  log(founder, 'Rohan Mehta set up the app as Founder');
  log(founder, 'Added team member Priya Sharma as Co-founder');
  log(founder, 'Added team member Aman Verma as Coordinator');
  log(founder, 'Created event "Aditi & Karan Wedding" (Wedding)');
  log(cofounder, 'Created event "Kabir\'s 1st Birthday" (Birthday)');
  log(cofounder, 'Received ₹80,000 from Sneha Arora for "Kabir\'s 1st Birthday" (upi)', 1);
  log(cofounder, 'Booked 5 worker(s) for "Kabir\'s 1st Birthday"');
});

console.log('Demo data added.');
console.log('  Founder:     founder@demo.com   / demo1234');
console.log('  Co-founder:  cofounder@demo.com / demo1234');
console.log('  Coordinator: aman@demo.com      / demo1234');
console.log(`  (${rows('SELECT id FROM events').length} events, ${rows('SELECT id FROM vendors').length} vendors, ${rows('SELECT id FROM workers').length} workers)`);
