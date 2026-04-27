"""
Build DEMOSEED.json v1.18
Keeps: functions, teams, domains, skills, people, programmes, providers (unchanged)
Replaces: projects, demand_items, external_resource_requirements, project_team_assignments
"""
import json, os

src = os.path.join(os.path.dirname(__file__), '..', 'DEMOSEED.json')
d = json.load(open(src))

functions = d['functions']
teams = d['teams']
domains = d['domains']
skills = d['skills']
people = d['people']
programmes = d['programmes']
providers = d['providers']

projects = [
  {
    'id': 'prj_001',
    'name': 'Plant D MES Concept Study',
    'owner': 'Sarah Chen',
    'type': 'Plant Project',
    'programme_id': 'prg_001',
    'description': 'Feasibility study for Plant D MES infrastructure upgrade. Draft — requirements not yet defined. PTAs in place for DM and GroupIT teams.',
    'status': 'Draft',
    'active': True,
    'phases': [
      {
        'id': 'phs_prj001_concept',
        'name': 'Concept & Feasibility',
        'start_month': '2026-09',
        'end_month': '2026-10',
        'funding_source': 'Plant/Sector Allocation',
        'funding_notes': '',
        'requirements': []
      },
      {
        'id': 'phs_prj001_design',
        'name': 'Design',
        'start_month': '2026-11',
        'end_month': '2027-01',
        'funding_source': 'Investment Scheme',
        'funding_notes': '',
        'requirements': []
      }
    ]
  },
  {
    'id': 'prj_002',
    'name': 'Plant E MES Refresh',
    'owner': 'Marcus Vogel',
    'type': 'Plant Project',
    'programme_id': 'prg_001',
    'description': 'MES refresh at Plant E. DM MOM/MI&V + GroupIT Data & Integration. Teams assigned; DM confirmed, GroupIT pending.',
    'status': 'Scoping',
    'active': True,
    'phases': [
      {
        'id': 'phs_prj002_spec',
        'name': 'Design & Specification',
        'start_month': '2026-08',
        'end_month': '2026-09',
        'funding_source': 'Plant/Sector Allocation',
        'funding_notes': '',
        'requirements': [
          {'id': 'req_prj002_spec_1', 'shape': 'skill', 'skill_id': 'skl_mom_mes', 'level': 'Advanced',
           'hours_by_month': {'2026-08': 60, '2026-09': 60}, 'notes': None, 'owningTeamId': 'team_001', 'allocations': []},
          {'id': 'req_prj002_spec_2', 'shape': 'skill', 'skill_id': 'skl_miv_integration', 'level': 'Advanced',
           'hours_by_month': {'2026-08': 40, '2026-09': 40}, 'notes': None, 'owningTeamId': 'team_001', 'allocations': []},
          {'id': 'req_prj002_spec_3', 'shape': 'skill', 'skill_id': 'skl_git_data_eng', 'level': 'Advanced',
           'hours_by_month': {'2026-08': 40, '2026-09': 40}, 'notes': None, 'owningTeamId': 'team_005', 'allocations': []}
        ]
      },
      {
        'id': 'phs_prj002_build',
        'name': 'Build & Integration',
        'start_month': '2026-10',
        'end_month': '2026-12',
        'funding_source': 'Plant/Sector Allocation',
        'funding_notes': '',
        'requirements': [
          {'id': 'req_prj002_build_1', 'shape': 'skill', 'skill_id': 'skl_mom_mes', 'level': 'Advanced',
           'hours_by_month': {'2026-10': 80, '2026-11': 80, '2026-12': 80}, 'notes': None, 'owningTeamId': 'team_001', 'allocations': []},
          {'id': 'req_prj002_build_2', 'shape': 'skill', 'skill_id': 'skl_mom_scada', 'level': 'Advanced',
           'hours_by_month': {'2026-10': 40, '2026-11': 40, '2026-12': 40}, 'notes': None, 'owningTeamId': 'team_002', 'allocations': []},
          {'id': 'req_prj002_build_3', 'shape': 'skill', 'skill_id': 'skl_git_data_eng', 'level': 'Specialist',
           'hours_by_month': {'2026-10': 60, '2026-11': 60, '2026-12': 60}, 'notes': None, 'owningTeamId': 'team_005', 'allocations': []},
          {'id': 'req_prj002_build_4', 'shape': 'skill', 'skill_id': 'skl_git_data_int_arch', 'level': 'Advanced',
           'hours_by_month': {'2026-10': 40, '2026-11': 40, '2026-12': 40}, 'notes': None, 'owningTeamId': 'team_005', 'allocations': []}
        ]
      }
    ]
  },
  {
    'id': 'prj_003',
    'name': 'Corporate Data Lake',
    'owner': 'Anya Petrov',
    'type': 'Group Strategy Project',
    'programme_id': None,
    'description': 'Enterprise data lake build. Cross-Function: DM MI&V + GroupIT Data & Integration. No Programme — demonstrates Unaligned Projects card.',
    'status': 'Submitted',
    'active': True,
    'phases': []
  },
  {
    'id': 'prj_004',
    'name': 'Plant C MES Platform Migration',
    'owner': 'David Lin',
    'type': 'Plant Project',
    'programme_id': 'prg_001',
    'description': 'Full MES platform migration at Plant C. Headline cross-Function flagship. DM (MOM+MI&V) PartiallyAllocated; GroupIT (Data & Integration) Approved.',
    'status': 'Approved',
    'active': True,
    'phases': []
  },
  {
    'id': 'prj_005',
    'name': 'MBM Foundation Library',
    'owner': 'Marcus Vogel',
    'type': 'Group Strategy Project',
    'programme_id': 'prg_002',
    'description': 'Digital twin foundation library for process simulation. Single-Function DM (MBM). Fully allocated.',
    'status': 'Allocated',
    'active': True,
    'phases': []
  },
  {
    'id': 'prj_006',
    'name': 'Plant B MES Refresh',
    'owner': 'Priya Kumar',
    'type': 'Plant Project',
    'programme_id': 'prg_001',
    'description': 'MES platform refresh at Plant B. Single-Function DM (MOM). Fully allocated.',
    'status': 'Allocated',
    'active': True,
    'phases': []
  }
]

demand_items = [
  # ── Spawned from Project 3 (Corporate Data Lake, Submitted) ──
  {
    'id': 'dmd_p3_dm',
    'name': 'Corporate Data Lake — Digital Manufacturing',
    'type': 'Group Strategy Project',
    'status': 'Submitted',
    'owner': 'James Whitfield',
    'description': 'DM MI&V integration slice for the Corporate Data Lake.',
    'function_id': 'func_001',
    'parent_project_id': 'prj_003',
    'phases': [
      {
        'id': 'phs_p3dm_main',
        'name': 'Build & Deploy',
        'start_month': '2026-07',
        'end_month': '2026-10',
        'funding_source': 'Investment Scheme',
        'funding_notes': '',
        'requirements': [
          {'id': 'req_p3dm_1', 'shape': 'skill', 'skill_id': 'skl_miv_integration', 'level': 'Advanced',
           'hours_by_month': {'2026-07': 40, '2026-08': 40, '2026-09': 40, '2026-10': 40},
           'notes': 'MI&V data integration pipelines for lake ingestion', 'allocations': []}
        ]
      }
    ]
  },
  {
    'id': 'dmd_p3_git',
    'name': 'Corporate Data Lake — Group IT Enterprise Solutions',
    'type': 'Group Strategy Project',
    'status': 'Submitted',
    'owner': 'Anya Petrov',
    'description': 'GroupIT Data & Integration platform build for the Corporate Data Lake.',
    'function_id': 'func_002',
    'parent_project_id': 'prj_003',
    'phases': [
      {
        'id': 'phs_p3git_main',
        'name': 'Build & Deploy',
        'start_month': '2026-07',
        'end_month': '2026-10',
        'funding_source': 'Investment Scheme',
        'funding_notes': '',
        'requirements': [
          {'id': 'req_p3git_1', 'shape': 'skill', 'skill_id': 'skl_git_data_eng', 'level': 'Specialist',
           'hours_by_month': {'2026-07': 80, '2026-08': 80, '2026-09': 80, '2026-10': 80},
           'notes': None, 'owningTeamId': 'team_005', 'allocations': []},
          {'id': 'req_p3git_2', 'shape': 'skill', 'skill_id': 'skl_git_data_int_arch', 'level': 'Advanced',
           'hours_by_month': {'2026-07': 40, '2026-08': 40, '2026-09': 40, '2026-10': 40},
           'notes': None, 'owningTeamId': 'team_005', 'allocations': []}
        ]
      }
    ]
  },
  # ── Spawned from Project 4 (Plant C MES Platform Migration, Approved) ──
  {
    'id': 'dmd_p4_dm',
    'name': 'Plant C MES Platform Migration — Digital Manufacturing',
    'type': 'Plant Project',
    'status': 'PartiallyAllocated',
    'owner': 'David Lin',
    'description': 'DM MOM and MI&V work for Plant C MES Platform Migration. Phase 1 fully allocated; Phase 2 partially in progress.',
    'function_id': 'func_001',
    'parent_project_id': 'prj_004',
    'phases': [
      {
        'id': 'phs_p4dm_spec',
        'name': 'Design & Specification',
        'start_month': '2026-06',
        'end_month': '2026-07',
        'funding_source': 'Plant/Sector Allocation',
        'funding_notes': 'Plant C capital budget',
        'requirements': [
          {'id': 'req_p4dm_spec_mes', 'shape': 'skill', 'skill_id': 'skl_mom_mes', 'level': 'Specialist',
           'hours_by_month': {'2026-06': 60, '2026-07': 60},
           'notes': 'Lead platform architect', 'owningTeamId': 'team_002',
           'allocations': [{'id': 'alc_p4dm_spec_mes', 'person_id': 'per_001',
                            'hours_by_month': {'2026-06': 60, '2026-07': 60}, 'notes': None}]},
          {'id': 'req_p4dm_spec_int', 'shape': 'skill', 'skill_id': 'skl_miv_integration', 'level': 'Advanced',
           'hours_by_month': {'2026-06': 40, '2026-07': 40},
           'notes': 'Data integration design', 'owningTeamId': 'team_001',
           'allocations': [{'id': 'alc_p4dm_spec_int', 'person_id': 'per_005',
                            'hours_by_month': {'2026-06': 40, '2026-07': 40}, 'notes': None}]}
        ]
      },
      {
        'id': 'phs_p4dm_build',
        'name': 'Build & Integration',
        'start_month': '2026-08',
        'end_month': '2026-10',
        'funding_source': 'Plant/Sector Allocation',
        'funding_notes': 'Plant C capital budget',
        'requirements': [
          {'id': 'req_p4dm_build_mes', 'shape': 'skill', 'skill_id': 'skl_mom_mes', 'level': 'Specialist',
           'hours_by_month': {'2026-08': 80, '2026-09': 80, '2026-10': 80},
           'notes': 'Platform build lead — 20 hrs/mo gap remains',
           'allocations': [{'id': 'alc_p4dm_build_mes', 'person_id': 'per_001',
                            'hours_by_month': {'2026-08': 60, '2026-09': 60, '2026-10': 60},
                            'notes': 'Partial — 20 hrs/mo unplanned'}]},
          {'id': 'req_p4dm_build_wf', 'shape': 'skill', 'skill_id': 'skl_mom_workflow', 'level': 'Advanced',
           'hours_by_month': {'2026-08': 40, '2026-09': 40, '2026-10': 40},
           'notes': None, 'allocations': []},
          {'id': 'req_p4dm_build_int', 'shape': 'skill', 'skill_id': 'skl_miv_integration', 'level': 'Advanced',
           'hours_by_month': {'2026-08': 40, '2026-09': 40, '2026-10': 40},
           'notes': None, 'owningTeamId': 'team_001',
           'allocations': [{'id': 'alc_p4dm_build_int', 'person_id': 'per_005',
                            'hours_by_month': {'2026-08': 40, '2026-09': 40, '2026-10': 40}, 'notes': None}]}
        ]
      }
    ]
  },
  {
    'id': 'dmd_p4_git',
    'name': 'Plant C MES Platform Migration — Group IT Enterprise Solutions',
    'type': 'Plant Project',
    'status': 'Approved',
    'owner': 'Anya Petrov',
    'description': 'GroupIT Data & Integration work for Plant C MES Platform Migration. Approved, pending resource planning.',
    'function_id': 'func_002',
    'parent_project_id': 'prj_004',
    'phases': [
      {
        'id': 'phs_p4git_spec',
        'name': 'Design & Specification',
        'start_month': '2026-06',
        'end_month': '2026-07',
        'funding_source': 'Plant/Sector Allocation',
        'funding_notes': '',
        'requirements': [
          {'id': 'req_p4git_spec_1', 'shape': 'skill', 'skill_id': 'skl_git_data_eng', 'level': 'Advanced',
           'hours_by_month': {'2026-06': 40, '2026-07': 40},
           'notes': None, 'owningTeamId': 'team_005', 'allocations': []}
        ]
      },
      {
        'id': 'phs_p4git_build',
        'name': 'Build & Integration',
        'start_month': '2026-08',
        'end_month': '2026-10',
        'funding_source': 'Plant/Sector Allocation',
        'funding_notes': '',
        'requirements': [
          {'id': 'req_p4git_build_1', 'shape': 'skill', 'skill_id': 'skl_git_data_eng', 'level': 'Specialist',
           'hours_by_month': {'2026-08': 60, '2026-09': 60, '2026-10': 60},
           'notes': 'Data integration layer for MES platform', 'owningTeamId': 'team_005', 'allocations': []},
          {'id': 'req_p4git_build_2', 'shape': 'skill', 'skill_id': 'skl_git_data_int_arch', 'level': 'Advanced',
           'hours_by_month': {'2026-08': 40, '2026-09': 40, '2026-10': 40},
           'notes': None, 'owningTeamId': 'team_005', 'allocations': []}
        ]
      }
    ]
  },
  # ── Spawned from Project 5 (MBM Foundation Library, Allocated) ──
  {
    'id': 'dmd_p5_dm',
    'name': 'MBM Foundation Library — Digital Manufacturing',
    'type': 'Group Strategy Project',
    'status': 'Allocated',
    'owner': 'Marcus Vogel',
    'description': 'DM MBM work for the MBM Foundation Library. Fully allocated.',
    'function_id': 'func_001',
    'parent_project_id': 'prj_005',
    'phases': [
      {
        'id': 'phs_p5dm_build',
        'name': 'Foundation Build',
        'start_month': '2026-05',
        'end_month': '2026-08',
        'funding_source': 'Investment Scheme',
        'funding_notes': 'Digital Twin innovation budget',
        'requirements': [
          {'id': 'req_p5dm_sim', 'shape': 'skill', 'skill_id': 'skl_mbm_simulation', 'level': 'Specialist',
           'hours_by_month': {'2026-05': 80, '2026-06': 80, '2026-07': 80, '2026-08': 80},
           'notes': 'Core simulation framework',
           'allocations': [{'id': 'alc_p5dm_sim', 'person_id': 'per_009',
                            'hours_by_month': {'2026-05': 80, '2026-06': 80, '2026-07': 80, '2026-08': 80},
                            'notes': None}]},
          {'id': 'req_p5dm_twin', 'shape': 'skill', 'skill_id': 'skl_mbm_twin', 'level': 'Advanced',
           'hours_by_month': {'2026-05': 60, '2026-06': 60, '2026-07': 60, '2026-08': 60},
           'notes': 'Digital twin integration',
           'allocations': [{'id': 'alc_p5dm_twin', 'person_id': 'per_010',
                            'hours_by_month': {'2026-05': 60, '2026-06': 60, '2026-07': 60, '2026-08': 60},
                            'notes': None}]}
        ]
      }
    ]
  },
  # ── Spawned from Project 6 (Plant B MES Refresh, Allocated) ──
  {
    'id': 'dmd_p6_dm',
    'name': 'Plant B MES Refresh — Digital Manufacturing',
    'type': 'Plant Project',
    'status': 'Allocated',
    'owner': 'Priya Kumar',
    'description': 'DM MOM work for Plant B MES Refresh. Fully allocated.',
    'function_id': 'func_001',
    'parent_project_id': 'prj_006',
    'phases': [
      {
        'id': 'phs_p6dm_rollout',
        'name': 'Rollout',
        'start_month': '2026-05',
        'end_month': '2026-07',
        'funding_source': 'Plant/Sector Allocation',
        'funding_notes': 'Plant B budget',
        'requirements': [
          {'id': 'req_p6dm_mes', 'shape': 'skill', 'skill_id': 'skl_mom_mes', 'level': 'Advanced',
           'hours_by_month': {'2026-05': 60, '2026-06': 60, '2026-07': 60},
           'notes': None,
           'allocations': [{'id': 'alc_p6dm_mes', 'person_id': 'per_002',
                            'hours_by_month': {'2026-05': 60, '2026-06': 60, '2026-07': 60}, 'notes': None}]},
          {'id': 'req_p6dm_scada', 'shape': 'skill', 'skill_id': 'skl_mom_scada', 'level': 'Advanced',
           'hours_by_month': {'2026-05': 40, '2026-06': 40, '2026-07': 40},
           'notes': None,
           'allocations': [{'id': 'alc_p6dm_scada', 'person_id': 'per_004',
                            'hours_by_month': {'2026-05': 40, '2026-06': 40, '2026-07': 40}, 'notes': None}]}
        ]
      }
    ]
  },
  # ── Direct Demands (5 total, all DM) ──
  {
    'id': 'dmd_d1',
    'name': 'Ad-hoc shift pattern review',
    'type': 'Plant Project',
    'status': 'Draft',
    'owner': 'Daniel Okafor',
    'description': 'Ad-hoc review of MES shift patterns at Plant A. 1 phase, 1 MOM Basic requirement. No external.',
    'function_id': 'func_001',
    'parent_project_id': None,
    'phases': [
      {
        'id': 'phs_d1_review',
        'name': 'Review',
        'start_month': '2026-07',
        'end_month': '2026-08',
        'funding_source': 'Plant/Sector Allocation',
        'funding_notes': '',
        'requirements': [
          {'id': 'req_d1_1', 'shape': 'skill', 'skill_id': 'skl_mom_mes', 'level': 'Basic',
           'hours_by_month': {'2026-07': 20, '2026-08': 20}, 'notes': None, 'allocations': []}
        ]
      }
    ]
  },
  {
    'id': 'dmd_d2',
    'name': 'Plant A SCADA migration assist',
    'type': 'Plant Project',
    'status': 'Submitted',
    'owner': 'Priya Kumar',
    'description': 'Assist with SCADA migration at Plant A. Submitted — Approve is the next-step CTA.',
    'function_id': 'func_001',
    'parent_project_id': None,
    'phases': [
      {
        'id': 'phs_d2_support',
        'name': 'Migration Support',
        'start_month': '2026-07',
        'end_month': '2026-09',
        'funding_source': 'Plant/Sector Allocation',
        'funding_notes': '',
        'requirements': [
          {'id': 'req_d2_1', 'shape': 'skill', 'skill_id': 'skl_mom_scada', 'level': 'Advanced',
           'hours_by_month': {'2026-07': 60, '2026-08': 60, '2026-09': 60}, 'notes': None, 'allocations': []}
        ]
      }
    ]
  },
  {
    'id': 'dmd_d3',
    'name': 'MES Super User support — Plant B',
    'type': 'BAU',
    'status': 'PartiallyAllocated',
    'owner': 'Alex Morgan',
    'description': 'Ongoing BAU MES super user support at Plant B. Indefinite phase; partial allocation in place. Has Other Internal Team external requirement.',
    'function_id': 'func_001',
    'parent_project_id': None,
    'phases': [
      {
        'id': 'phs_d3_ongoing',
        'name': 'Ongoing support',
        'start_month': '2026-05',
        'end_month': None,
        'funding_source': 'Plant/Sector Allocation',
        'funding_notes': 'Plant B BAU budget',
        'requirements': [
          {'id': 'req_d3_1', 'shape': 'skill', 'skill_id': 'skl_mom_mes', 'level': 'Basic',
           'steady_state_hours': 40, 'notes': 'Day-to-day MES support',
           'allocations': [{'id': 'alc_d3_1', 'person_id': 'per_003',
                            'steady_state_hours': 20, 'notes': None}]}
        ]
      }
    ]
  },
  {
    'id': 'dmd_d4',
    'name': 'Historian configuration handover',
    'type': 'Plant Project',
    'status': 'Allocated',
    'owner': 'James Whitfield',
    'description': 'Configuration handover for historian upgrade at Plant B. Fully allocated.',
    'function_id': 'func_001',
    'parent_project_id': None,
    'phases': [
      {
        'id': 'phs_d4_handover',
        'name': 'Handover',
        'start_month': '2026-05',
        'end_month': '2026-06',
        'funding_source': 'Plant/Sector Allocation',
        'funding_notes': '',
        'requirements': [
          {'id': 'req_d4_1', 'shape': 'skill', 'skill_id': 'skl_miv_historian', 'level': 'Advanced',
           'hours_by_month': {'2026-05': 60, '2026-06': 60}, 'notes': None,
           'allocations': [{'id': 'alc_d4_1', 'person_id': 'per_005',
                            'hours_by_month': {'2026-05': 60, '2026-06': 60}, 'notes': None}]}
        ]
      }
    ]
  },
  {
    'id': 'dmd_d5',
    'name': 'Plant A OEE enhancement',
    'type': 'Plant Project',
    'status': 'Approved',
    'owner': 'Fatima Al-Rashid',
    'description': 'OEE metric enhancement at Plant A. Approved, ready for resource planning.',
    'function_id': 'func_001',
    'parent_project_id': None,
    'phases': [
      {
        'id': 'phs_d5_impl',
        'name': 'Implementation',
        'start_month': '2026-09',
        'end_month': '2026-10',
        'funding_source': 'Plant/Sector Allocation',
        'funding_notes': '',
        'requirements': [
          {'id': 'req_d5_1', 'shape': 'skill', 'skill_id': 'skl_mom_oee', 'level': 'Advanced',
           'hours_by_month': {'2026-09': 40, '2026-10': 40}, 'notes': None, 'allocations': []},
          {'id': 'req_d5_2', 'shape': 'skill', 'skill_id': 'skl_miv_analytics', 'level': 'Advanced',
           'hours_by_month': {'2026-09': 40, '2026-10': 40}, 'notes': None, 'allocations': []}
        ]
      }
    ]
  }
]

external_resource_requirements = [
  # Project 4 Plant C — OEM + Managed Services on DM Demand Build phase
  {
    'id': 'ext_p4_oem',
    'phase_id': 'phs_p4dm_build',
    'provider_id': 'prv_003',
    'role': 'MES Platform Vendor Support',
    'notes': 'OEM provides specialist platform configuration support during build.',
    'hours_by_month': {'2026-08': 40, '2026-09': 40, '2026-10': 40},
    'steady_state_hours': None
  },
  {
    'id': 'ext_p4_ms',
    'phase_id': 'phs_p4dm_build',
    'provider_id': 'prv_001',
    'role': 'SCADA Engineer',
    'notes': 'Managed Services SCADA resource for integration work.',
    'hours_by_month': {'2026-08': 120, '2026-09': 120, '2026-10': 120},
    'steady_state_hours': None
  },
  # Project 3 Corporate Data Lake — Contractor on GroupIT Demand phase
  {
    'id': 'ext_p3_contractor',
    'phase_id': 'phs_p3git_main',
    'provider_id': 'prv_002',
    'role': 'Data Engineer',
    'notes': 'Contract data engineer for pipeline build and integration testing.',
    'hours_by_month': {'2026-07': 80, '2026-08': 80, '2026-09': 80, '2026-10': 80},
    'steady_state_hours': None
  },
  # Direct Demand D3 — Other Internal Team indefinite
  {
    'id': 'ext_d3_oit',
    'phase_id': 'phs_d3_ongoing',
    'provider_id': 'prv_005',
    'role': 'Plant Electrician Support',
    'notes': 'Plant B electricians provide hardware first-line support for MES-connected equipment.',
    'hours_by_month': {},
    'steady_state_hours': 10
  }
]

project_team_assignments = [
  # Project 1 (Draft) — 2 teams assigned, neither confirmed
  {
    'id': 'pta_prj001_dm',
    'projectId': 'prj_001',
    'phaseId': 'phs_prj001_concept',
    'teamId': 'team_001',
    'confirmed': False,
    'confirmedBy': None,
    'confirmedAt': None
  },
  {
    'id': 'pta_prj001_git',
    'projectId': 'prj_001',
    'phaseId': 'phs_prj001_concept',
    'teamId': 'team_004',
    'confirmed': False,
    'confirmedBy': None,
    'confirmedAt': None
  },
  # Project 2 (Scoping) — 1 confirmed (DM), 1 not (GroupIT)
  {
    'id': 'pta_prj002_dm',
    'projectId': 'prj_002',
    'phaseId': 'phs_prj002_spec',
    'teamId': 'team_001',
    'confirmed': True,
    'confirmedBy': 'Marcus Vogel',
    'confirmedAt': '2026-05-10'
  },
  {
    'id': 'pta_prj002_git',
    'projectId': 'prj_002',
    'phaseId': 'phs_prj002_spec',
    'teamId': 'team_005',
    'confirmed': False,
    'confirmedBy': None,
    'confirmedAt': None
  }
]

new_seed = {
  '_meta': {
    'version': '1.18',
    'description': (
      'v1.18 seed: 6 Projects (Draft/Scoping/Submitted/Approved/Allocated), '
      '6 spawned Demands, 5 direct DM Demands (all 5 statuses). '
      'Cross-Function Project 4 (DM PartiallyAllocated + GroupIT Approved). '
      'DM function_capacity Aug-2026 = 1534h. GroupIT function_capacity Aug-2026 = 882h. '
      'Data & Integration domain_capacity: 152h Jul-2026, 304h Aug-2026.'
    ),
    'today': '2026-05-01'
  },
  'functions': functions,
  'teams': teams,
  'domains': domains,
  'skills': skills,
  'people': people,
  'programmes': programmes,
  'projects': projects,
  'demand_items': demand_items,
  'providers': providers,
  'external_resource_requirements': external_resource_requirements,
  'project_team_assignments': project_team_assignments
}

out = os.path.join(os.path.dirname(__file__), '..', 'DEMOSEED.json')
with open(out, 'w') as f:
    json.dump(new_seed, f, indent=2, ensure_ascii=False)

print(f"Written {out}")
print(f"  projects: {len(projects)}")
print(f"  demand_items: {len(demand_items)}")
print(f"  external_reqs: {len(external_resource_requirements)}")
print(f"  project_team_assignments: {len(project_team_assignments)}")
statuses = sorted(d['status'] for d in demand_items if d['function_id']=='func_001')
print(f"  DM demand statuses: {statuses}")
