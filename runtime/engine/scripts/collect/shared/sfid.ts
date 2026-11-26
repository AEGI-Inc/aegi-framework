/** Salesforce 15자 id 를 18자로 (대소문자 표시 세 글자를 붙인다). 18자는 그대로 */
const SF_SUFFIX = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345'
export function to18(id: string): string {
  if (!/^[A-Za-z0-9]{15}$/.test(id)) return id
  let suffix = ''
  for (let chunk = 0; chunk < 3; chunk++) {
    let bits = 0
    for (let i = 0; i < 5; i++) if (/[A-Z]/.test(id[chunk * 5 + i])) bits |= 1 << i
    suffix += SF_SUFFIX[bits]
  }
  return id + suffix
}
