// Runtime adapters for reviewed Knowledge bindings. An entry identifies the
// source operation; it does not make every tenant reference a membership.
const sources = {
  'op:gws_directory:directory.users.list': { id: 'relation-binding:gws-user-member-of-tenant', selector: '$.users[*]', provider: 'gws', call: 'GW-03', source: 'gws:User', target: 'gws:Customer', targetType: 'Customer' },
  'op:okta_management_openapi:listUsers': { id: 'relation-binding:okta-user-member-of-tenant', selector: '$[*]', provider: 'okta', call: 'OK-02', source: 'okta:UserGetSingleton', target: 'okta:Org', targetType: 'OrgSetting' },
  'op:jira_openapi_v3:getAllUsers': { id: 'relation-binding:jira-user-member-of-tenant', selector: '$[*]', provider: 'atlassian', service: 'jira', call: 'JI-02', source: 'jira:User', target: 'atlassian:site', targetType: 'ServerInformation' },
  'op:sf_object_reference:User.query': { id: 'relation-binding:salesforce-user-member-of-tenant', selector: '$.records[*]', provider: 'salesforce', call: 'SF-02', source: 'salesforce:User', target: 'salesforce:Organization', targetType: 'Organization' },
}

// Q05 is a reviewed user-list binding, not the still-open decision to turn all
// tenant references into Relation rows. Only emit for measured list records.
export function applyReviewedReferenceRules({ bindings, objects, addRelation }) {
  let emitted = 0
  for (const binding of bindings) {
    const source = sources[binding.input?.operation_ref]
    if (!source || binding.id !== source.id || binding.input?.record_selector !== source.selector || Object.keys(binding.input).some(k => !['operation_ref', 'record_selector'].includes(k)) || binding.slots?.source?.space !== source.source || binding.slots?.target?.space !== source.target || !binding.decision_refs?.includes('Q05') || !['decided_binding', 'decided_binding_extended'].includes(binding.status) || binding.relation_type !== 'member_of' || binding.template_case !== 'Principal --> Tenant' || binding.basis !== 'stated') continue
    for (const [key, object] of objects) {
      const c = object.canonical
      if (c.provider !== source.provider || (source.service && c.service !== source.service) || c.object_type !== 'User' || !c.interfaces?.includes('Principal') || object.fixture_meta?.stub) continue
      const observation = c.source?.observations?.find(o => o.params?.call_id === source.call && (source.call !== 'SF-02' || (o.params?.soql_object === 'User' && o.params?.part == null)))
      if (!observation) continue
      const targets = c.references?.tenant?.targets ?? []
      if (targets.length !== 1) continue
      const target = objects.get(targets[0].value)
      if (!target || target.fixture_meta?.stub || target.canonical.provider !== c.provider || target.canonical.object_type !== source.targetType || !target.canonical.interfaces?.includes('Tenant') || key === targets[0].value) continue
      addRelation({ file: `knowledge:${binding.id}` }, 'member_of', key, targets[0].value, observation, { basis: 'stated' })
      emitted++
    }
  }
  return emitted
}
