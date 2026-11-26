/**
 *   npm run snapshots -- --env preview|production                      스냅샷 목록과 current
 *   npm run rollback  -- --env preview|production [--to <스냅샷 id>]    직전(또는 지정) ready 스냅샷으로 포인터를 되돌린다
 *   npx tsx scripts/loader/snapshotCli.ts pin   --env preview --id <스냅샷 id> --reason <읽는 곳>   정리(prune)에서 빼는 고정 표시
 *   npx tsx scripts/loader/snapshotCli.ts unpin --env preview --id <스냅샷 id>                     고정 표시를 푼다
 *
 * 대시보드 화면은 D1 current 스냅샷을 직접 읽으므로, rollback 은 D1 포인터만 되돌린다.
 */
import { connect } from './connect.ts'
import { getHead, isPinned, listSnapshots, pinSnapshot, rollbackHead } from './snapshot.ts'
import { parseTarget } from './target.ts'

async function main() {
  const [command, ...rest] = process.argv.slice(2)
  const target = parseTarget(rest, { requireDataset: false })
  // rollback 은 포인터만 바꾼다. 스키마는 publish 만 바꾼다
  const exec = await connect(target)

  if (command === 'list') {
    const head = await getHead(exec)
    const snaps = await listSnapshots(exec)
    console.log(`[${target.env}] current: ${head?.snapshot_id ?? '없음'} (이전 ${head?.previous_snapshot_id ?? '없음'}, ${head?.updated_at ?? '-'}, ${head?.reason ?? '-'})`)
    for (const s of snaps) {
      const counts = JSON.parse(s.counts) as Record<string, number>
      const mark = s.id === head?.snapshot_id ? '*' : ' '
      console.log(`${mark} ${s.id}  ${s.status.padEnd(9)} 데이터셋 ${s.dataset_name ?? '-'} (생성 ${s.dataset_created_at ?? '-'})  객체 ${counts.snap_objects ?? 0}, 관계 ${counts.snap_relations ?? 0}, 위협 ${counts.snap_findings ?? 0}  엔진 ${s.engine_version ?? '-'}  적재 ${s.loaded_at ?? '-'}${s.note ? `  메모 ${s.note}` : ''}`)
    }
    return
  }

  if (command === 'rollback') {
    const head = await rollbackHead(exec, target.options.get('--to'))
    console.log(`[${target.env}] current: ${head.snapshot_id} (되돌리기 전 ${head.previous_snapshot_id})`)
    return
  }

  if (command === 'pin' || command === 'unpin') {
    const id = target.options.get('--id')
    if (!id) throw new Error('--id <스냅샷 id> 가 없다')
    const snap = await pinSnapshot(exec, id, command === 'pin' ? target.options.get('--reason') ?? '' : null)
    console.log(`[${target.env}] ${snap.id}: ${isPinned(snap) ? `고정 (${snap.note})` : '고정 풀림'}`)
    return
  }

  throw new Error('사용: snapshotCli.ts list|rollback|pin|unpin --env preview|production [--to <스냅샷 id>] [--id <스냅샷 id> --reason <읽는 곳>]')
}

main().catch(err => {
  console.error(`[오류] ${err.message}`)
  process.exit(1)
})
