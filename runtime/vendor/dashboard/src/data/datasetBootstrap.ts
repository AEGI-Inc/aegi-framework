/** App을 불러오기 전에 최신 실측(v2 또는 ver IM)을 등록한다. 배포본은 팀 로그인 뒤 KV에서 받는다. */
import measuredV2Local from "virtual:aegi-measured-v2"
import measuredImLocal from "virtual:aegi-measured-im"
import { registerDatasetOverride } from "./datasetStore"
import { createDatasetSession } from "./datasetSession"

export type DatasetKind = "measured-v2" | "measured-im"

const STORAGE_KEY = "aegi.dataset"

function readStoredDataset(): DatasetKind | null {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY)
    return v === "measured-v2" || v === "measured-im" ? v : null
  } catch {
    return null
  }
}

export const measuredImAvailable = Boolean(measuredImLocal)
const storedDataset = typeof window !== "undefined" ? readStoredDataset() : null
export const activeDataset: DatasetKind =
  storedDataset === "measured-im" && measuredImLocal
    ? "measured-im"
    : storedDataset === "measured-v2" && measuredV2Local
      ? "measured-v2"
      : measuredImLocal
        ? "measured-im"
        : "measured-v2"

const selectedLocal = activeDataset === "measured-im" && measuredImLocal ? measuredImLocal : measuredV2Local
export const measuredV2Source = selectedLocal ? "local" : "remote"
const session = createDatasetSession(selectedLocal, registerDatasetOverride, (...args) => fetch(...args))
export const bootstrapDataset = () => session.bootstrap()
export const loginMeasured = (password: string) => session.login(password)
export const datasetProblem = () => session.problem

export function switchDataset(kind: DatasetKind): void {
  if (kind === activeDataset) return
  try {
    window.localStorage.setItem(STORAGE_KEY, kind)
  } catch {
    // ignore storage errors
  }
  window.location.reload()
}

export async function logoutMeasured(): Promise<void> {
  const response = await fetch("/api/measured/logout", { method: "POST", credentials: "same-origin" })
  if (!response.ok) throw new Error('로그아웃하지 못했습니다. 잠시 뒤 다시 시도해 주세요.')
  window.location.reload()
}
