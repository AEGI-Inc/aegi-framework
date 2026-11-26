import { type CallApi, type CallDef, TenantMismatchError, httpClassifier } from '../lib/runner'
import { awsSigV4Auth } from '../lib/auth'
import { missingCredential, type CollectorConfig } from '../config'
import type { ProviderContext } from './common'

export { TenantMismatchError }

export function assertSameTenant(provider: string, expected: string, actual: string, field = 'Account'): void {
  if (expected && actual && expected !== actual) {
    throw new TenantMismatchError(`${provider} ${field} ${actual} != 설정 ${expected}`)
  }
}

function auth(ctx: ProviderContext) {
  return awsSigV4Auth({
    ref: 'CRED-AWS-01',
    accessKeyId: ctx.creds.require('AWS_ACCESS_KEY_ID'),
    secretAccessKey: ctx.creds.require('AWS_SECRET_ACCESS_KEY'),
    sessionToken: ctx.creds.get('AWS_SESSION_TOKEN'),
    region: ctx.config.aws?.region ?? 'ap-northeast-2',
  })
}

function xmlTag(xml: string, tag: string): string | undefined {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(xml)
  return m ? m[1].trim() : undefined
}

function xmlBlocks(xml: string, tag: string): string[] {
  const out: string[] = []
  const openRe = new RegExp(`<${tag}(?:\\s[^>/]*)?>`, 'g')
  const closeTag = `</${tag}>`
  let pos = 0
  while (pos < xml.length) {
    openRe.lastIndex = pos
    const m = openRe.exec(xml)
    if (!m) break
    const startContent = m.index + m[0].length
    let depth = 1
    let cursor = startContent
    while (depth > 0 && cursor < xml.length) {
      openRe.lastIndex = cursor
      const nextOpen = openRe.exec(xml)
      const nextClose = xml.indexOf(closeTag, cursor)
      if (nextClose === -1) break
      if (nextOpen && nextOpen.index < nextClose) {
        depth++
        cursor = nextOpen.index + nextOpen[0].length
      } else {
        depth--
        if (depth === 0) {
          out.push(xml.slice(startContent, nextClose))
          pos = nextClose + closeTag.length
          break
        }
        cursor = nextClose + closeTag.length
      }
    }
    if (depth > 0) break
  }
  return out
}

function xmlItems(xml: string, containerTag: string, itemTag = 'item'): string[] {
  const out: string[] = []
  for (const inner of xmlBlocks(xml, containerTag)) {
    out.push(...xmlBlocks(inner, itemTag))
  }
  return out
}

export function parseAwsXml(xml: string, action?: string): any {
  const s = xml.trim()
  if (!s.startsWith('<')) return xml
  const nextToken = xmlTag(s, 'NextToken') ?? xmlTag(s, 'nextToken')
  const marker = xmlTag(s, 'Marker') ?? xmlTag(s, 'marker')
  const isTruncated = xmlTag(s, 'IsTruncated') === 'true'

  if (action === 'DescribeVpcs' || s.includes('<DescribeVpcsResponse')) {
    const cleanVpcXml = s
      .replace(/<cidrBlockAssociationSet>[\s\S]*?<\/cidrBlockAssociationSet>/g, '')
      .replace(/<ipv6CidrBlockAssociationSet>[\s\S]*?<\/ipv6CidrBlockAssociationSet>/g, '')
      .replace(/<tagSet>[\s\S]*?<\/tagSet>/g, '')
    return {
      nextToken,
      Vpcs: xmlItems(cleanVpcXml, 'vpcSet').map(v => ({
        VpcId: xmlTag(v, 'vpcId'),
        OwnerId: xmlTag(v, 'ownerId'),
        State: xmlTag(v, 'state'),
        CidrBlock: xmlTag(v, 'cidrBlock'),
        IsDefault: xmlTag(v, 'isDefault') === 'true',
      })),
    }
  }
  if (action === 'DescribeSubnets' || s.includes('<DescribeSubnetsResponse')) {
    const cleanSubXml = s
      .replace(/<ipv6CidrBlockAssociationSet>[\s\S]*?<\/ipv6CidrBlockAssociationSet>/g, '')
      .replace(/<tagSet>[\s\S]*?<\/tagSet>/g, '')
    return {
      nextToken,
      Subnets: xmlItems(cleanSubXml, 'subnetSet').map(sub => ({
        SubnetId: xmlTag(sub, 'subnetId'),
        VpcId: xmlTag(sub, 'vpcId'),
        OwnerId: xmlTag(sub, 'ownerId'),
        CidrBlock: xmlTag(sub, 'cidrBlock'),
        AvailabilityZone: xmlTag(sub, 'availabilityZone'),
        MapPublicIpOnLaunch: xmlTag(sub, 'mapPublicIpOnLaunch') === 'true',
      })),
    }
  }
  if (action === 'DescribeSecurityGroups' || s.includes('<DescribeSecurityGroupsResponse')) {
    const cleanSgXml = s
      .replace(/<ipPermissionsEgress>[\s\S]*?<\/ipPermissionsEgress>/g, '')
      .replace(/<tagSet>[\s\S]*?<\/tagSet>/g, '')
    return {
      nextToken,
      SecurityGroups: xmlItems(cleanSgXml, 'securityGroupInfo').map(sg => ({
        GroupId: xmlTag(sg, 'groupId'),
        GroupName: xmlTag(sg, 'groupName'),
        Description: xmlTag(sg, 'groupDescription'),
        VpcId: xmlTag(sg, 'vpcId'),
        OwnerId: xmlTag(sg, 'ownerId'),
        IpPermissions: xmlItems(sg, 'ipPermissions').map(perm => {
          const cleanPerm = perm.replace(/<groups>[\s\S]*?<\/groups>/g, '').replace(/<prefixListIds>[\s\S]*?<\/prefixListIds>/g, '')
          return {
            IpProtocol: xmlTag(cleanPerm, 'ipProtocol'),
            FromPort: xmlTag(cleanPerm, 'fromPort') ? Number(xmlTag(cleanPerm, 'fromPort')) : undefined,
            ToPort: xmlTag(cleanPerm, 'toPort') ? Number(xmlTag(cleanPerm, 'toPort')) : undefined,
            IpRanges: xmlItems(cleanPerm, 'ipRanges').map(r => ({ CidrIp: xmlTag(r, 'cidrIp') })),
            Ipv6Ranges: xmlItems(cleanPerm, 'ipv6Ranges').map(r => ({ CidrIpv6: xmlTag(r, 'cidrIpv6') })),
          }
        }),
      })),
    }
  }
  if (action === 'DescribeInstances' || s.includes('<DescribeInstancesResponse')) {
    const cleanInstXml = s
      .replace(/<networkInterfaceSet>[\s\S]*?<\/networkInterfaceSet>/g, '')
      .replace(/<blockDeviceMapping>[\s\S]*?<\/blockDeviceMapping>/g, '')
      .replace(/<tagSet>[\s\S]*?<\/tagSet>/g, '')
      .replace(/<productCodes>[\s\S]*?<\/productCodes>/g, '')
      .replace(/<groupSet\s*\/>/g, '')
    return {
      nextToken,
      Reservations: [
        {
          Instances: xmlItems(cleanInstXml, 'instancesSet').map(inst => {
            const stateXml = xmlTag(inst, 'instanceState') ?? ''
            const iamXml = xmlTag(inst, 'iamInstanceProfile')
            return {
              InstanceId: xmlTag(inst, 'instanceId'),
              InstanceType: xmlTag(inst, 'instanceType'),
              State: { Name: xmlTag(stateXml, 'name') },
              VpcId: xmlTag(inst, 'vpcId'),
              SubnetId: xmlTag(inst, 'subnetId'),
              PublicIpAddress: xmlTag(inst, 'ipAddress'),
              PrivateIpAddress: xmlTag(inst, 'privateIpAddress'),
              IamInstanceProfile: iamXml ? { Arn: xmlTag(iamXml, 'arn'), Id: xmlTag(iamXml, 'id') } : undefined,
              SecurityGroups: xmlItems(inst, 'groupSet').map(g => ({
                GroupId: xmlTag(g, 'groupId'),
                GroupName: xmlTag(g, 'groupName'),
              })),
            }
          }),
        },
      ],
    }
  }
  if (action === 'DescribeDBInstances' || s.includes('<DescribeDBInstancesResponse')) {
    return {
      Marker: marker,
      DBInstances: xmlItems(s, 'DBInstances', 'DBInstance').map(db => {
        const subGroup = xmlTag(db, 'DBSubnetGroup')
        const ep = xmlTag(db, 'Endpoint')
        return {
          DBInstanceIdentifier: xmlTag(db, 'DBInstanceIdentifier'),
          DBInstanceArn: xmlTag(db, 'DBInstanceArn'),
          DBInstanceClass: xmlTag(db, 'DBInstanceClass'),
          Engine: xmlTag(db, 'Engine'),
          EngineVersion: xmlTag(db, 'EngineVersion'),
          DBInstanceStatus: xmlTag(db, 'DBInstanceStatus'),
          PubliclyAccessible: xmlTag(db, 'PubliclyAccessible') === 'true',
          StorageEncrypted: xmlTag(db, 'StorageEncrypted') === 'true',
          DBSubnetGroup: subGroup ? { VpcId: xmlTag(subGroup, 'VpcId') } : undefined,
          Endpoint: ep ? { Address: xmlTag(ep, 'Address'), Port: xmlTag(ep, 'Port') ? Number(xmlTag(ep, 'Port')) : undefined } : undefined,
          VpcSecurityGroups: xmlItems(db, 'VpcSecurityGroups', 'VpcSecurityGroupMembership').map(vsg => ({
            VpcSecurityGroupId: xmlTag(vsg, 'VpcSecurityGroupId'),
            Status: xmlTag(vsg, 'Status'),
          })),
        }
      }),
    }
  }
  if (action === 'ListUsers' || s.includes('<ListUsersResponse')) {
    return {
      IsTruncated: isTruncated,
      Marker: marker,
      Users: xmlItems(s, 'Users', 'member').map(u => ({
        UserName: xmlTag(u, 'UserName'),
        UserId: xmlTag(u, 'UserId'),
        Arn: xmlTag(u, 'Arn'),
        Path: xmlTag(u, 'Path'),
        CreateDate: xmlTag(u, 'CreateDate'),
      })),
    }
  }
  if (action === 'ListRoles' || s.includes('<ListRolesResponse')) {
    return {
      IsTruncated: isTruncated,
      Marker: marker,
      Roles: xmlItems(s, 'Roles', 'member').map(r => ({
        RoleName: xmlTag(r, 'RoleName'),
        RoleId: xmlTag(r, 'RoleId'),
        Arn: xmlTag(r, 'Arn'),
        Path: xmlTag(r, 'Path'),
        CreateDate: xmlTag(r, 'CreateDate'),
        AssumeRolePolicyDocument: xmlTag(r, 'AssumeRolePolicyDocument'),
      })),
    }
  }
  if (action === 'ListAccessKeys' || s.includes('<ListAccessKeysResponse')) {
    return {
      IsTruncated: isTruncated,
      Marker: marker,
      AccessKeyMetadata: xmlItems(s, 'AccessKeyMetadata', 'member').map(k => ({
        UserName: xmlTag(k, 'UserName'),
        AccessKeyId: xmlTag(k, 'AccessKeyId'),
        Status: xmlTag(k, 'Status'),
        CreateDate: xmlTag(k, 'CreateDate'),
      })),
    }
  }
  if (
    action === 'ListAttachedRolePolicies' ||
    s.includes('<ListAttachedRolePoliciesResponse') ||
    action === 'ListAttachedUserPolicies' ||
    s.includes('<ListAttachedUserPoliciesResponse')
  ) {
    return {
      IsTruncated: isTruncated,
      Marker: marker,
      AttachedPolicies: xmlItems(s, 'AttachedPolicies', 'member').map(p => ({
        PolicyName: xmlTag(p, 'PolicyName'),
        PolicyArn: xmlTag(p, 'PolicyArn'),
      })),
    }
  }
  if (
    action === 'ListUserPolicies' ||
    s.includes('<ListUserPoliciesResponse') ||
    action === 'ListRolePolicies' ||
    s.includes('<ListRolePoliciesResponse')
  ) {
    return {
      IsTruncated: isTruncated,
      Marker: marker,
      PolicyNames: xmlItems(s, 'PolicyNames', 'member').map(p => p.trim()),
    }
  }
  if (action === 'ListGroupsForUser' || s.includes('<ListGroupsForUserResponse')) {
    return {
      IsTruncated: isTruncated,
      Marker: marker,
      Groups: xmlItems(s, 'Groups', 'member').map(g => ({
        GroupId: xmlTag(g, 'GroupId'),
        GroupName: xmlTag(g, 'GroupName'),
        Arn: xmlTag(g, 'Arn'),
        Path: xmlTag(g, 'Path'),
        CreateDate: xmlTag(g, 'CreateDate'),
      })),
    }
  }
  if (action === 'ListInstanceProfiles' || s.includes('<ListInstanceProfilesResponse')) {
    return {
      IsTruncated: isTruncated,
      Marker: marker,
      InstanceProfiles: xmlItems(s, 'InstanceProfiles', 'member').map(ip => ({
        InstanceProfileId: xmlTag(ip, 'InstanceProfileId'),
        InstanceProfileName: xmlTag(ip, 'InstanceProfileName'),
        Arn: xmlTag(ip, 'Arn'),
        Path: xmlTag(ip, 'Path'),
        CreateDate: xmlTag(ip, 'CreateDate'),
        Roles: xmlItems(ip, 'Roles', 'member').map(r => ({
          RoleId: xmlTag(r, 'RoleId'),
          RoleName: xmlTag(r, 'RoleName'),
          Arn: xmlTag(r, 'Arn'),
        })),
      })),
    }
  }
  if (s.includes('<ListAllMyBucketsResult')) {
    return {
      Buckets: xmlItems(s, 'Buckets', 'Bucket').map(b => ({
        Name: xmlTag(b, 'Name'),
        CreationDate: xmlTag(b, 'CreationDate'),
      })),
    }
  }
  if (s.includes('<PublicAccessBlockConfiguration')) {
    return {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: xmlTag(s, 'BlockPublicAcls') === 'true',
        IgnorePublicAcls: xmlTag(s, 'IgnorePublicAcls') === 'true',
        BlockPublicPolicy: xmlTag(s, 'BlockPublicPolicy') === 'true',
        RestrictPublicBuckets: xmlTag(s, 'RestrictPublicBuckets') === 'true',
      },
    }
  }
  return xml
}

export function unwrapAws(data: any, action?: string): any {
  if (typeof data === 'string') {
    data = parseAwsXml(data, action)
  }
  if (!data || typeof data !== 'object') return data
  if (action) {
    const respKey = `${action}Response`
    const resKey = `${action}Result`
    if (data[respKey]?.[resKey] !== undefined) return data[respKey][resKey]
    if (data[respKey] !== undefined) return data[respKey]
    if (data[resKey] !== undefined) return data[resKey]
  }
  for (const k of Object.keys(data)) {
    if (k.endsWith('Response') && data[k] && typeof data[k] === 'object') {
      for (const rk of Object.keys(data[k])) {
        if (rk.endsWith('Result')) return data[k][rk]
      }
      return data[k]
    }
  }
  return data
}

function getAccountId(api: CallApi, config: CollectorConfig): string | undefined {
  if (config.aws?.accountId) return config.aws.accountId
  const stsPages = api.collected('aws', 'AWS-01')
  const account = (stsPages[0]?.payload as any)?.Account
  return account ? String(account) : undefined
}

export function awsCalls(ctx: ProviderContext): CallDef[] {
  const { config, creds } = ctx
  const unavailable = () =>
    missingCredential(creds, 'CRED-AWS-01') ??
    (!config.aws ? 'config_missing:aws' : !config.aws.region ? 'config_missing:aws.region' : null)

  const region = config.aws?.region!

  return [
    {
      id: 'AWS-01',
      provider: 'aws',
      title: 'STS GetCallerIdentity',
      credential: 'CRED-AWS-01',
      unavailable,
      run: async (api: CallApi) => {
        if (!config.aws) return
        const identityUrl = `https://sts.${region}.amazonaws.com/?Action=GetCallerIdentity&Version=2011-06-15`
        await api.get({
          url: identityUrl,
          auth: auth(ctx),
          headers: { Accept: 'application/json' },
          transform: body => {
            const unwrapped = unwrapAws(body, 'GetCallerIdentity')
            const account = unwrapped?.Account ?? unwrapped?.account
            const arn = unwrapped?.Arn ?? unwrapped?.arn
            const userId = unwrapped?.UserId ?? unwrapped?.userId
            if (config.aws?.accountId) {
              assertSameTenant('aws', config.aws.accountId, String(account ?? ''), 'GetCallerIdentity.Account')
            }
            return { Account: account, Arn: arn, UserId: userId, Region: region }
          },
        })
      },
    },
    {
      id: 'AWS-02',
      provider: 'aws',
      title: 'IAM Users, Roles, Attached Policies, Access Keys',
      credential: 'CRED-AWS-01',
      unavailable,
      run: async (api: CallApi) => {
        if (!config.aws) return
        const accountId = getAccountId(api, config)

        // 1. ListUsers
        const listUsersUrl = 'https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08'
        const users = await api.list({
          url: listUsersUrl,
          auth: auth(ctx),
          headers: { Accept: 'application/json' },
          params: { kind: 'users' },
          paginate: { kind: 'aws', style: 'iam' },
          transform: body => {
            const unwrapped = unwrapAws(body, 'ListUsers')
            const raw = unwrapped?.Users ?? []
            const list = Array.isArray(raw) ? raw : [raw].filter(Boolean)
            if (accountId) {
              for (const u of list) u.AccountId = accountId
            }
            return { ...unwrapped, Users: list }
          },
          items: body => body?.Users ?? [],
        })

        // Sub-calls for each user
        for (const u of users) {
          const uName = u.UserName
          // access_keys
          await api.optional(`access_keys:${uName}`, async () => {
            const keysUrl = `https://iam.amazonaws.com/?Action=ListAccessKeys&UserName=${encodeURIComponent(uName)}&Version=2010-05-08`
            return await api.list({
              url: keysUrl,
              auth: auth(ctx),
              headers: { Accept: 'application/json' },
              params: { kind: 'access_keys', user_name: uName },
              paginate: { kind: 'aws', style: 'iam' },
              transform: body => {
                const unwrapped = unwrapAws(body, 'ListAccessKeys')
                const raw = unwrapped?.AccessKeyMetadata ?? unwrapped?.AccessKeys ?? []
                const list = Array.isArray(raw) ? raw : [raw].filter(Boolean)
                for (const k of list) {
                  if (!k.UserName) k.UserName = uName
                  if (accountId) k.AccountId = accountId
                }
                return {
                  ...unwrapped,
                  AccessKeyMetadata: list,
                  AccessKeys: list,
                  IsTruncated: unwrapped?.IsTruncated,
                  Marker: unwrapped?.Marker,
                }
              },
              items: body => body?.AccessKeyMetadata ?? [],
            })
          })

          // user_attached_policies
          await api.optional(`user_attached_policies:${uName}`, async () => {
            const url = `https://iam.amazonaws.com/?Action=ListAttachedUserPolicies&UserName=${encodeURIComponent(uName)}&Version=2010-05-08`
            return await api.list({
              url,
              auth: auth(ctx),
              headers: { Accept: 'application/json' },
              params: { kind: 'user_attached_policies', user_name: uName },
              paginate: { kind: 'aws', style: 'iam' },
              transform: body => unwrapAws(body, 'ListAttachedUserPolicies'),
              items: body => body?.AttachedPolicies ?? [],
            })
          })

          // user_inline_policies
          await api.optional(`user_inline_policies:${uName}`, async () => {
            const url = `https://iam.amazonaws.com/?Action=ListUserPolicies&UserName=${encodeURIComponent(uName)}&Version=2010-05-08`
            return await api.list({
              url,
              auth: auth(ctx),
              headers: { Accept: 'application/json' },
              params: { kind: 'user_inline_policies', user_name: uName },
              paginate: { kind: 'aws', style: 'iam' },
              transform: body => unwrapAws(body, 'ListUserPolicies'),
              items: body => body?.PolicyNames ?? [],
            })
          })

          // user_groups
          await api.optional(`user_groups:${uName}`, async () => {
            const url = `https://iam.amazonaws.com/?Action=ListGroupsForUser&UserName=${encodeURIComponent(uName)}&Version=2010-05-08`
            return await api.list({
              url,
              auth: auth(ctx),
              headers: { Accept: 'application/json' },
              params: { kind: 'user_groups', user_name: uName },
              paginate: { kind: 'aws', style: 'iam' },
              transform: body => unwrapAws(body, 'ListGroupsForUser'),
              items: body => body?.Groups ?? [],
            })
          })
        }

        // 2. ListRoles
        const listRolesUrl = 'https://iam.amazonaws.com/?Action=ListRoles&Version=2010-05-08'
        const roles = await api.list({
          url: listRolesUrl,
          auth: auth(ctx),
          headers: { Accept: 'application/json' },
          params: { kind: 'roles' },
          paginate: { kind: 'aws', style: 'iam' },
          transform: body => {
            const unwrapped = unwrapAws(body, 'ListRoles')
            const raw = unwrapped?.Roles ?? []
            const list = Array.isArray(raw) ? raw : [raw].filter(Boolean)
            for (const r of list) {
              if (accountId) r.AccountId = accountId
              let doc = r.AssumeRolePolicyDocument
              if (typeof doc === 'string') {
                try {
                  if (doc.includes('%')) doc = decodeURIComponent(doc)
                  doc = JSON.parse(doc)
                } catch {
                  doc = null
                }
              }
              const statements = doc && Array.isArray(doc.Statement) ? doc.Statement : (doc?.Statement ? [doc.Statement] : [])
              const trustedServices: string[] = []
              const trustedAwsPrincipals: string[] = []
              const trustedFederated: string[] = []
              const trustedOidcRepos: string[] = []

              for (const stmt of statements) {
                if (stmt?.Effect === 'Allow') {
                  const p = stmt.Principal
                  if (p) {
                    if (p.Service) {
                      const arr = Array.isArray(p.Service) ? p.Service : [p.Service]
                      trustedServices.push(...arr)
                    }
                    if (p.AWS) {
                      const arr = Array.isArray(p.AWS) ? p.AWS : [p.AWS]
                      trustedAwsPrincipals.push(...arr)
                    }
                    if (p.Federated) {
                      const arr = Array.isArray(p.Federated) ? p.Federated : [p.Federated]
                      trustedFederated.push(...arr)
                    }
                  }
                  const cond = stmt.Condition
                  if (cond) {
                    const sub =
                      cond.StringEquals?.['token.actions.githubusercontent.com:sub'] ??
                      cond.StringLike?.['token.actions.githubusercontent.com:sub']
                    if (sub) {
                      const subs = Array.isArray(sub) ? sub : [sub]
                      for (const s of subs) {
                        if (typeof s === 'string' && s.startsWith('repo:')) {
                          const parts = s.slice(5).split(':')
                          if (parts[0]) trustedOidcRepos.push(parts[0])
                        }
                      }
                    }
                  }
                }
              }
              r.TrustedServices = [...new Set(trustedServices)]
              r.TrustedAwsPrincipals = [...new Set(trustedAwsPrincipals)]
              r.TrustedFederated = [...new Set(trustedFederated)]
              r.TrustedOidcRepos = [...new Set(trustedOidcRepos)]
            }
            return {
              ...unwrapped,
              Roles: list,
              IsTruncated: unwrapped?.IsTruncated,
              Marker: unwrapped?.Marker,
            }
          },
          items: body => body?.Roles ?? [],
        })

        // Sub-calls for each role
        for (const r of roles) {
          const rName = r.RoleName
          // role_attached_policies
          await api.optional(`role_attached_policies:${rName}`, async () => {
            const url = `https://iam.amazonaws.com/?Action=ListAttachedRolePolicies&RoleName=${encodeURIComponent(rName)}&Version=2010-05-08`
            return await api.list({
              url,
              auth: auth(ctx),
              headers: { Accept: 'application/json' },
              params: { kind: 'role_attached_policies', role_name: rName },
              paginate: { kind: 'aws', style: 'iam' },
              transform: body => unwrapAws(body, 'ListAttachedRolePolicies'),
              items: body => body?.AttachedPolicies ?? [],
            })
          })

          // role_inline_policies
          await api.optional(`role_inline_policies:${rName}`, async () => {
            const url = `https://iam.amazonaws.com/?Action=ListRolePolicies&RoleName=${encodeURIComponent(rName)}&Version=2010-05-08`
            return await api.list({
              url,
              auth: auth(ctx),
              headers: { Accept: 'application/json' },
              params: { kind: 'role_inline_policies', role_name: rName },
              paginate: { kind: 'aws', style: 'iam' },
              transform: body => unwrapAws(body, 'ListRolePolicies'),
              items: body => body?.PolicyNames ?? [],
            })
          })
        }
      },
    },
    {
      id: 'AWS-03',
      provider: 'aws',
      title: 'EC2 VPCs, Subnets, SecurityGroups, Instances',
      credential: 'CRED-AWS-01',
      unavailable,
      run: async (api: CallApi) => {
        if (!config.aws) return

        // 1. vpcs
        const vpcUrl = `https://ec2.${region}.amazonaws.com/?Action=DescribeVpcs&Version=2016-11-15`
        await api.list({
          url: vpcUrl,
          auth: auth(ctx),
          headers: { Accept: 'application/json' },
          params: { kind: 'vpcs' },
          paginate: { kind: 'aws', style: 'ec2' },
          transform: body => {
            const unwrapped = unwrapAws(body, 'DescribeVpcs')
            return {
              ...unwrapped,
              Vpcs: unwrapped?.Vpcs ?? unwrapped?.vpcSet?.item ?? [],
              NextToken: unwrapped?.NextToken ?? unwrapped?.nextToken,
              nextToken: unwrapped?.nextToken ?? unwrapped?.NextToken,
            }
          },
          items: body => body?.Vpcs ?? body?.vpcSet?.item ?? [],
        })

        // 2. subnets
        const subnetUrl = `https://ec2.${region}.amazonaws.com/?Action=DescribeSubnets&Version=2016-11-15`
        await api.list({
          url: subnetUrl,
          auth: auth(ctx),
          headers: { Accept: 'application/json' },
          params: { kind: 'subnets' },
          paginate: { kind: 'aws', style: 'ec2' },
          transform: body => {
            const unwrapped = unwrapAws(body, 'DescribeSubnets')
            return {
              ...unwrapped,
              Subnets: unwrapped?.Subnets ?? unwrapped?.subnetSet?.item ?? [],
              NextToken: unwrapped?.NextToken ?? unwrapped?.nextToken,
              nextToken: unwrapped?.nextToken ?? unwrapped?.NextToken,
            }
          },
          items: body => body?.Subnets ?? body?.subnetSet?.item ?? [],
        })

        // 3. security_groups
        const sgUrl = `https://ec2.${region}.amazonaws.com/?Action=DescribeSecurityGroups&Version=2016-11-15`
        await api.list({
          url: sgUrl,
          auth: auth(ctx),
          headers: { Accept: 'application/json' },
          params: { kind: 'security_groups' },
          paginate: { kind: 'aws', style: 'ec2' },
          transform: body => {
            const unwrapped = unwrapAws(body, 'DescribeSecurityGroups')
            const raw = unwrapped?.SecurityGroups ?? unwrapped?.securityGroupInfo?.item ?? []
            const list = Array.isArray(raw) ? raw : [raw].filter(Boolean)
            for (const sg of list) {
              const permissions = sg.IpPermissions ?? []
              sg.OpenToInternet = permissions.some((perm: any) =>
                (perm.IpRanges ?? []).some((r: any) => r.CidrIp === '0.0.0.0/0') ||
                (perm.Ipv6Ranges ?? []).some((r: any) => r.CidrIpv6 === '::/0')
              )
            }
            return {
              ...unwrapped,
              SecurityGroups: list,
              NextToken: unwrapped?.NextToken ?? unwrapped?.nextToken,
              nextToken: unwrapped?.nextToken ?? unwrapped?.NextToken,
            }
          },
          items: body => body?.SecurityGroups ?? body?.securityGroupInfo?.item ?? [],
        })

        // 4. instances
        const instUrl = `https://ec2.${region}.amazonaws.com/?Action=DescribeInstances&Version=2016-11-15`
        await api.list({
          url: instUrl,
          auth: auth(ctx),
          headers: { Accept: 'application/json' },
          params: { kind: 'instances' },
          paginate: { kind: 'aws', style: 'ec2' },
          transform: body => {
            const unwrapped = unwrapAws(body, 'DescribeInstances')
            const resListRaw = unwrapped?.Reservations ?? unwrapped?.reservationSet?.item ?? []
            const reservations = Array.isArray(resListRaw) ? resListRaw : [resListRaw].filter(Boolean)
            const instances = reservations.flatMap((res: any) => {
              const list = res.Instances ?? res.instancesSet?.item ?? []
              return Array.isArray(list) ? list : [list].filter(Boolean)
            })
            for (const inst of instances) {
              if (inst.IamInstanceProfile?.Arn && !inst.IamInstanceProfileArn) {
                inst.IamInstanceProfileArn = inst.IamInstanceProfile.Arn
              }
              if (inst.SecurityGroups && !inst.SecurityGroupIds) {
                inst.SecurityGroupIds = (inst.SecurityGroups ?? []).map((g: any) => g.GroupId)
              }
            }
            return {
              ...unwrapped,
              Instances: instances,
              NextToken: unwrapped?.NextToken ?? unwrapped?.nextToken,
              nextToken: unwrapped?.nextToken ?? unwrapped?.NextToken,
            }
          },
          items: body => body?.Instances ?? [],
        })

        // 5. instance_profiles
        await api.optional('instance_profiles', async () => {
          const ipUrl = 'https://iam.amazonaws.com/?Action=ListInstanceProfiles&Version=2010-05-08'
          return await api.list({
            url: ipUrl,
            auth: auth(ctx),
            headers: { Accept: 'application/json' },
            params: { kind: 'instance_profiles' },
            paginate: { kind: 'aws', style: 'iam' },
            transform: body => unwrapAws(body, 'ListInstanceProfiles'),
            items: body => body?.InstanceProfiles ?? [],
          })
        })
      },
    },
    {
      id: 'AWS-04',
      provider: 'aws',
      title: 'RDS DBInstances',
      credential: 'CRED-AWS-01',
      unavailable,
      run: async (api: CallApi) => {
        if (!config.aws) return
        const rdsUrl = `https://rds.${region}.amazonaws.com/?Action=DescribeDBInstances&Version=2014-10-31`
        await api.list({
          url: rdsUrl,
          auth: auth(ctx),
          headers: { Accept: 'application/json' },
          params: { kind: 'db_instances' },
          paginate: { kind: 'aws', style: 'rds' },
          transform: body => {
            const unwrapped = unwrapAws(body, 'DescribeDBInstances')
            const rdsRaw = unwrapped?.DBInstances ?? []
            const dbInstances = Array.isArray(rdsRaw) ? rdsRaw : [rdsRaw].filter(Boolean)
            for (const db of dbInstances) {
              db.VpcId = db.DBSubnetGroup?.VpcId ?? db.VpcId
              db.EndpointAddress = db.Endpoint?.Address ?? db.EndpointAddress
              db.EndpointPort = db.Endpoint?.Port ?? db.EndpointPort
              db.SecurityGroupIds = (db.VpcSecurityGroups ?? []).map((g: any) => g.VpcSecurityGroupId)
            }
            return {
              ...unwrapped,
              DBInstances: dbInstances,
              Marker: unwrapped?.Marker ?? unwrapped?.marker,
            }
          },
          items: body => body?.DBInstances ?? [],
        })
      },
    },
    {
      id: 'AWS-05',
      provider: 'aws',
      title: 'S3 Buckets & Public Access',
      credential: 'CRED-AWS-01',
      unavailable,
      run: async (api: CallApi) => {
        if (!config.aws) return
        const accountId = getAccountId(api, config)
        const s3Url = `https://s3.${region}.amazonaws.com/`
        const bucketRes = await api.get({
          url: s3Url,
          auth: auth(ctx),
          headers: { Accept: 'application/json' },
          params: { kind: 'buckets' },
          transform: body => {
            const unwrapped = unwrapAws(body)
            const raw = unwrapped?.Buckets ?? unwrapped?.ListAllMyBucketsResult?.Buckets?.Bucket ?? []
            const buckets = Array.isArray(raw) ? raw : [raw].filter(Boolean)
            for (const b of buckets) {
              if (accountId) b.AccountId = accountId
            }
            return { ...unwrapped, Buckets: buckets }
          },
        })
        const buckets = bucketRes?.Buckets ?? []

        for (const b of buckets) {
          const bName = b.Name
          await api.optional(`bucket_public_access_block:${bName}`, async () => {
            const pabUrl = `https://s3.${region}.amazonaws.com/${encodeURIComponent(bName)}?publicAccessBlock`
            return await api.get({
              url: pabUrl,
              auth: auth(ctx),
              headers: { Accept: 'application/json' },
              params: { kind: 'bucket_public_access_block', bucket: bName },
              classify: res => {
                if (res.status === 404) return null
                return httpClassifier(res)
              },
              transform: body => {
                if (
                  typeof body === 'string' &&
                  (body.includes('NoSuchPublicAccessBlockConfiguration') ||
                    body.includes('404 Not Found') ||
                    body.includes('<Error><Code>NoSuchPublicAccessBlockConfiguration</Code>'))
                ) {
                  return { configured: false }
                }
                const unwrapped = unwrapAws(body)
                if (unwrapped?.PublicAccessBlockConfiguration) {
                  return { configured: true, ...unwrapped.PublicAccessBlockConfiguration }
                }
                return { configured: false }
              },
            })
          })
        }
      },
    },
    {
      id: 'AWS-06',
      provider: 'aws',
      title: 'Lambda Functions',
      credential: 'CRED-AWS-01',
      unavailable,
      run: async (api: CallApi) => {
        if (!config.aws) return
        const accountId = getAccountId(api, config)
        const lambdaUrl = `https://lambda.${region}.amazonaws.com/2015-03-31/functions`
        await api.list({
          url: lambdaUrl,
          auth: auth(ctx),
          headers: { Accept: 'application/json' },
          params: { kind: 'functions' },
          paginate: { kind: 'aws', style: 'lambda' },
          transform: body => {
            const fnsRaw = body?.Functions ?? []
            const functions = Array.isArray(fnsRaw) ? fnsRaw : [fnsRaw].filter(Boolean)
            for (const fn of functions) {
              if (accountId) fn.AccountId = accountId
              if (fn.Environment && fn.Environment.Variables) {
                fn.EnvironmentVariableKeys = Object.keys(fn.Environment.Variables)
              } else {
                fn.EnvironmentVariableKeys = []
              }
              delete fn.Environment
              fn.RoleName = fn.Role ? fn.Role.split('/').pop() : undefined
            }
            return {
              ...body,
              Functions: functions,
              NextMarker: body?.NextMarker,
            }
          },
          items: body => body?.Functions ?? [],
        })
      },
    },
  ]
}
