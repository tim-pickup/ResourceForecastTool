import json, os

d = json.load(open(os.path.join(os.path.dirname(__file__), '..', 'DEMOSEED.json')))

print('=== PROJECTS ===')
for p in d['projects']:
    print(f"  {p['id']} {p['name'][:40]:40} status={p['status']:12} activities={len(p['activities'])}")

print('\n=== DEMAND STATUSES ===')
dm = [di for di in d['demand_items'] if di['function_id'] == 'func_001']
git = [di for di in d['demand_items'] if di['function_id'] == 'func_002']
print(f"  DM statuses: {sorted(set(di['status'] for di in dm))}")
print(f"  GroupIT statuses: {sorted(set(di['status'] for di in git))}")
print(f"  Total demands: {len(d['demand_items'])}")

print('\n=== CAPACITY Aug 2026 ===')
REAL = {'Approved', 'PartiallyAllocated', 'Allocated'}
demands = d['demand_items']

def month_in_range(m, frm, to):
    if frm and m < frm: return False
    if to and m > to: return False
    return True

def real_committed(pid, month):
    total = 0
    for item in demands:
        if item['status'] not in REAL: continue
        for ac in item.get('activities', []):
            if not month_in_range(month, ac['start_month'], ac.get('end_month')): continue
            for req in ac.get('requirements', []):
                for alloc in req.get('allocations', []):
                    if alloc['person_id'] != pid: continue
                    if ac.get('end_month') is None:
                        total += alloc.get('steady_state_hours', 0) or 0
                    else:
                        total += alloc.get('hours_by_month', {}).get(month, 0)
    return total

month = '2026-08'
for fn_id, fn_name in [('func_001', 'DM'), ('func_002', 'GroupIT')]:
    fn_team_ids = {t['id'] for t in d['teams'] if t['functionId'] == fn_id}
    total = 0
    for p in d['people']:
        if not p.get('active', True): continue
        if p['teamId'] not in fn_team_ids: continue
        if not month_in_range(month, p.get('available_from'), p.get('available_to')): continue
        rc = real_committed(p['id'], month)
        cap = max(0, p['contracted_hours_per_month'] - rc)
        total += cap
    print(f"  {fn_name} function_capacity({month}) = {total}h")

print('\n=== DATA & INTEGRATION DOMAIN CAPACITY ===')
data_int_skills = {s['id'] for s in d['skills'] if s['domain_id'] == 'thm_git_data'}
git_team_ids = {t['id'] for t in d['teams'] if t['functionId'] == 'func_002'}

for month in ['2026-07', '2026-08']:
    total = 0
    for p in d['people']:
        if not p.get('active', True): continue
        if p['teamId'] not in git_team_ids: continue
        if not month_in_range(month, p.get('available_from'), p.get('available_to')): continue
        has_di_skill = any(ps['skill_id'] in data_int_skills for ps in p.get('skills', []))
        if not has_di_skill: continue
        # Count commitments to NON-D&I skills
        other_committed = 0
        for item in demands:
            if item['status'] not in REAL: continue
            for ac in item.get('activities', []):
                if not month_in_range(month, ac['start_month'], ac.get('end_month')): continue
                for req in ac.get('requirements', []):
                    if req['skill_id'] in data_int_skills: continue  # skip D&I skills
                    for alloc in req.get('allocations', []):
                        if alloc['person_id'] != p['id']: continue
                        if ac.get('end_month') is None:
                            other_committed += alloc.get('steady_state_hours', 0) or 0
                        else:
                            other_committed += alloc.get('hours_by_month', {}).get(month, 0)
        total += max(0, p['contracted_hours_per_month'] - other_committed)
    print(f"  domain_capacity(Data & Integration, {month}) = {total}h (expected: {'152' if month == '2026-07' else '304'}h)")

print('\n=== PROJECT 4 CHILD DEMANDS ===')
p4 = [di for di in d['demand_items'] if di['parent_project_id'] == 'prj_004']
for di in p4:
    print(f"  {di['id']} {di['name']} status={di['status']}")

print(f"\nAll checks complete. Seed version: {d['_meta']['version']}")
