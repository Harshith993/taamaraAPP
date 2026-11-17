'use strict';

// Every permission the app knows about. The Founder role always has all of them.
// Other roles get whatever the founder ticks on the Team & Permissions page.
const PERMISSIONS = [
  { key: 'events.view', group: 'Events', label: 'View events, clients and schedules' },
  { key: 'events.edit', group: 'Events', label: 'Create & edit events, book vendors and labor, mark attendance' },
  { key: 'vendors.view', group: 'Vendors', label: 'View vendor directory and contacts' },
  { key: 'vendors.edit', group: 'Vendors', label: 'Add & edit vendors' },
  { key: 'labor.view', group: 'Labor', label: 'View labor list and contacts' },
  { key: 'labor.edit', group: 'Labor', label: 'Add & edit workers' },
  { key: 'tasks.manage', group: 'Tasks', label: 'Create tasks and assign them to anyone' },
  { key: 'finance.view', group: 'Money', label: 'See money: package prices, vendor rates, wages, payments, profit' },
  { key: 'finance.edit', group: 'Money', label: 'Record payments received and paid' },
  { key: 'records.delete', group: 'Admin', label: 'Delete events, vendors, workers and payments' },
  { key: 'activity.view', group: 'Admin', label: 'See the activity log (who changed what)' },
  { key: 'team.manage', group: 'Admin', label: 'Add team members and change roles & permissions' },
  { key: 'settings.manage', group: 'Admin', label: 'Change business settings' },
];

const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

// Having the right-hand permission automatically gives the left-hand ones.
const IMPLIES = {
  'events.edit': ['events.view'],
  'vendors.edit': ['vendors.view'],
  'labor.edit': ['labor.view'],
  'finance.edit': ['finance.view'],
};

function normalizePermissions(list) {
  const set = new Set((Array.isArray(list) ? list : []).filter((k) => PERMISSION_KEYS.includes(k)));
  for (const key of [...set]) for (const implied of IMPLIES[key] || []) set.add(implied);
  return PERMISSION_KEYS.filter((k) => set.has(k));
}

const DEFAULT_ROLES = [
  {
    name: 'Founder',
    description: 'Full access to everything. Cannot be restricted.',
    is_owner: 1,
    permissions: PERMISSION_KEYS,
  },
  {
    name: 'Co-founder',
    description: 'Runs events, vendors, labor and money. Cannot manage the team, settings or delete records.',
    is_owner: 0,
    permissions: normalizePermissions([
      'events.edit', 'vendors.edit', 'labor.edit', 'tasks.manage', 'finance.edit', 'activity.view',
    ]),
  },
  {
    name: 'Event Manager',
    description: 'Handles events, vendors and labor day to day. Cannot see money.',
    is_owner: 0,
    permissions: normalizePermissions(['events.edit', 'vendors.edit', 'labor.edit', 'tasks.manage']),
  },
  {
    name: 'Coordinator',
    description: 'On-ground staff. Can see schedules and contacts, and tick off their own tasks.',
    is_owner: 0,
    permissions: normalizePermissions(['events.view', 'vendors.view', 'labor.view']),
  },
];

module.exports = { PERMISSIONS, PERMISSION_KEYS, normalizePermissions, DEFAULT_ROLES };
